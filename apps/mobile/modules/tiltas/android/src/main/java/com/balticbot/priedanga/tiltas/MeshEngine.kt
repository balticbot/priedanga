// Tiltas mesh engine on Android BLE: serves verified alerts from a GATT
// server and fetches missing ones as a GATT client (packages/tiltas/SPEC.md
// §3, §5). Same rules as ios/Core/MeshEngine.swift. It never verifies or
// relays what it fetches: received envelopes wait in the inbox until the app
// has verified them and handed them back through setOffers().

package com.balticbot.priedanga.tiltas

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class Offer(val key: Key, val priority: Int, val expires: Long, val envelope: ByteArray) {
  val entry get() = InventoryEntry(key, priority, expires)
}

data class MeshStatus(
  /** idle | unknown | unsupported | unauthorized | off | on */
  val bluetooth: String,
  val running: Boolean,
  val served: Int,
  val inbox: Int,
  val peersSeen: Int,
  val sessions: Int,
  val received: Int,
  val lastSync: Long?,
)

object MeshLimits {
  const val SERVED = Tiltas.MAX_INVENTORY
  const val INBOX = 16
  const val FETCHES_PER_SESSION = 8
  const val COOLDOWN_MS = 60_000L
  const val PENALTY_MS = 300_000L
  const val REJECT_MS = 3_600_000L
  const val CONNECT_TIMEOUT_MS = 10_000L
  const val SESSION_TIMEOUT_MS = 20_000L
  const val RESCAN_MS = 30_000L
  const val MTU = 517
}

private const val TAG = "Tiltas"

/** One client-side sync session against one peer. */
private class Session(val device: BluetoothDevice) {
  var gatt: BluetoothGatt? = null
  var inventory: BluetoothGattCharacteristic? = null
  var select: BluetoothGattCharacteristic? = null
  var chunk: BluetoothGattCharacteristic? = null
  var plan = ArrayDeque<InventoryEntry>()
  var current: InventoryEntry? = null
  val chunks = mutableListOf<Chunk>()
  var fetched = 0
  var connected = false
}

@SuppressLint("MissingPermission") // every BLE call runs only after hasPermissions()
class MeshEngine(context: Context) {
  var onStatus: ((MeshStatus) -> Unit)? = null
  var onInbox: ((Int) -> Unit)? = null

  private val app = context.applicationContext
  private val thread = HandlerThread("tiltas").apply { start() }
  private val handler = Handler(thread.looper)
  private val stateFile = File(app.filesDir, "tiltas-state.json")
  private val manager = app.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
  private val adapter: BluetoothAdapter? get() = manager?.adapter

  private var running = false
  private var served = listOf<Offer>()
  private val inbox = mutableListOf<Pair<Key, ByteArray>>()
  private val rejected = HashMap<Key, Long>()
  private val cooldown = HashMap<String, Long>()
  private val peersSeen = HashSet<String>()
  private var sessions = 0
  private var received = 0
  private var lastSync: Long? = null

  private var server: BluetoothGattServer? = null
  private var advertising = false
  private var scanning = false
  private val selection = HashMap<String, Pair<Key, Int>>()
  /** Value returned at offset 0 of a long read, kept for the follow-up offsets. */
  private val readCache = HashMap<String, ByteArray>()
  private var session: Session? = null
  private var receiverRegistered = false

  init {
    handler.post { load() }
  }

  // ---- Public API (thread-safe) ---------------------------------------------

  fun start() = handler.post {
    running = true
    if (!receiverRegistered) {
      val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
      if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(stateReceiver, filter, Context.RECEIVER_EXPORTED)
      else app.registerReceiver(stateReceiver, filter)
      receiverRegistered = true
    }
    bringUp()
    emitStatus()
  }

  fun stop() = handler.post {
    running = false
    tearDown()
    emitStatus()
  }

  /** Replace the served set with alerts the app has verified. Keys are recomputed here. */
  fun setOffers(offers: List<Triple<ByteArray, Int, Long>>) = handler.post {
    served = offers.mapNotNull { (envelope, priority, expires) ->
      if (priority !in 0..Tiltas.MAX_PRIORITY) return@mapNotNull null
      val body = try { Frames.envelopeBody(envelope) } catch (e: FrameException) { return@mapNotNull null }
      Offer(Frames.meshKey(body), priority, expires, envelope)
    }
    pruneServed()
    val keys = served.map { it.key }.toSet()
    inbox.removeAll { it.first in keys }
    save()
    emitStatus()
  }

  /** Hand the unverified envelopes to the app and clear the inbox. */
  fun drainInbox(): List<ByteArray> = onHandler {
    val out = inbox.map { it.second }
    inbox.clear()
    save()
    emitStatus()
    out
  }

  /** Keys whose alerts failed verification: not fetched again for an hour. */
  fun markRejected(keys: List<ByteArray>) = handler.post {
    val now = System.currentTimeMillis()
    for (k in keys) if (k.size == Tiltas.KEY_BYTES) rejected[Key(k)] = now
  }

  fun status(): MeshStatus = onHandler { currentStatus() }

  private fun <T> onHandler(block: () -> T): T {
    if (Thread.currentThread() == thread) return block()
    var result: Result<T>? = null
    val latch = CountDownLatch(1)
    handler.post {
      result = runCatching(block)
      latch.countDown()
    }
    latch.await(5, TimeUnit.SECONDS)
    return result?.getOrThrow() ?: throw IllegalStateException("tiltas thread busy")
  }

  // ---- Store -----------------------------------------------------------------

  private fun nowSec() = System.currentTimeMillis() / 1000

  private fun pruneServed() {
    val t = nowSec()
    val seen = HashSet<Key>()
    served = served.filter { it.expires > t }
      .sortedWith { a, b -> InventoryEntry.URGENCY.compare(a.entry, b.entry) }
      .filter { seen.add(it.key) }
      .take(MeshLimits.SERVED)
  }

  private fun holds(key: Key): Boolean {
    rejected[key]?.let { if (System.currentTimeMillis() - it >= MeshLimits.REJECT_MS) rejected.remove(key) }
    return rejected.containsKey(key) || served.any { it.key == key } || inbox.any { it.first == key }
  }

  private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)

  private fun save() {
    try {
      val json = JSONObject()
      json.put("served", JSONArray(served.map {
        JSONObject().put("priority", it.priority).put("expires", it.expires).put("envelope", b64(it.envelope))
      }))
      json.put("inbox", JSONArray(inbox.map { b64(it.second) }))
      val tmp = File(stateFile.path + ".tmp")
      tmp.writeText(json.toString())
      tmp.renameTo(stateFile)
    } catch (e: Exception) {
      Log.w(TAG, "save failed", e)
    }
  }

  private fun load() {
    try {
      if (!stateFile.exists()) return
      val json = JSONObject(stateFile.readText())
      val s = json.optJSONArray("served") ?: JSONArray()
      served = (0 until s.length()).mapNotNull { i ->
        val o = s.getJSONObject(i)
        val env = Base64.decode(o.getString("envelope"), Base64.NO_WRAP)
        val body = try { Frames.envelopeBody(env) } catch (e: FrameException) { return@mapNotNull null }
        Offer(Frames.meshKey(body), o.getInt("priority"), o.getLong("expires"), env)
      }
      val inb = json.optJSONArray("inbox") ?: JSONArray()
      for (i in 0 until inb.length()) {
        val env = Base64.decode(inb.getString(i), Base64.NO_WRAP)
        val body = try { Frames.envelopeBody(env) } catch (e: FrameException) { continue }
        inbox.add(Frames.meshKey(body) to env)
      }
    } catch (e: Exception) {
      Log.w(TAG, "load failed", e)
    }
  }

  // ---- Bluetooth state ---------------------------------------------------------

  private fun hasPermissions(): Boolean {
    val needed = if (Build.VERSION.SDK_INT >= 31) {
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    return needed.all { app.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
  }

  private fun bluetoothState(): String {
    val a = adapter ?: return "unsupported"
    if (!app.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return "unsupported"
    if (!hasPermissions()) return "unauthorized"
    return if (a.isEnabled) "on" else "off"
  }

  private fun currentStatus() = MeshStatus(
    bluetooth = if (!running && server == null && !receiverRegistered) "idle" else bluetoothState(),
    running = running, served = served.size, inbox = inbox.size, peersSeen = peersSeen.size,
    sessions = sessions, received = received, lastSync = lastSync,
  )

  private fun emitStatus() {
    onStatus?.invoke(currentStatus())
  }

  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      handler.post {
        if (bluetoothState() == "on" && running) bringUp() else tearDown()
        emitStatus()
      }
    }
  }

  private fun bringUp() {
    if (!running || bluetoothState() != "on") return
    startServer()
    startAdvertising()
    startScanning()
  }

  private fun tearDown() {
    handler.removeCallbacks(rescan)
    if (session != null) finish(failed = false)
    if (hasPermissions()) {
      try {
        if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        if (advertising) adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        server?.close()
      } catch (e: Exception) {
        Log.w(TAG, "teardown", e)
      }
    }
    scanning = false
    advertising = false
    server = null
    selection.clear()
    readCache.clear()
  }

  // ---- Server (peripheral) side ------------------------------------------------

  private fun startServer() {
    if (server != null) return
    val s = manager?.openGattServer(app, serverCallback) ?: return
    val service = BluetoothGattService(Tiltas.SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(
      BluetoothGattCharacteristic(Tiltas.INVENTORY_UUID, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ),
    )
    service.addCharacteristic(
      BluetoothGattCharacteristic(Tiltas.SELECT_UUID, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE),
    )
    service.addCharacteristic(
      BluetoothGattCharacteristic(Tiltas.CHUNK_UUID, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ),
    )
    s.addService(service)
    server = s
  }

  private fun startAdvertising() {
    if (advertising) return
    val advertiser = adapter?.bluetoothLeAdvertiser ?: return
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(Tiltas.SERVICE_UUID)).setIncludeDeviceName(false).build()
    advertiser.startAdvertising(settings, data, advertiseCallback)
    advertising = true
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      Log.w(TAG, "advertising failed: $errorCode")
      handler.post { advertising = false }
    }
  }

  private fun readValue(uuid: java.util.UUID, device: String): ByteArray? = when (uuid) {
    Tiltas.INVENTORY_UUID -> {
      pruneServed()
      Frames.encodeInventory(served.map { it.entry })
    }
    Tiltas.CHUNK_UUID -> {
      val sel = selection[device]
      val offer = sel?.let { s -> served.firstOrNull { it.key == s.first } }
      if (sel != null && offer != null) Frames.encodeChunk(offer.envelope, sel.second) else Frames.NOT_AVAILABLE
    }
    else -> null
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) handler.post {
        selection.remove(device.address)
        readCache.keys.removeAll { it.startsWith(device.address) }
      }
    }

    override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      handler.post {
        val cacheKey = "${device.address}/${characteristic.uuid}"
        val value = if (offset == 0) readValue(characteristic.uuid, device.address).also { v -> if (v != null) readCache[cacheKey] = v }
        else readCache[cacheKey]
        val s = server ?: return@post
        when {
          value == null -> s.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          offset > value.size -> s.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
          else -> s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value.copyOfRange(offset, value.size))
        }
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?,
    ) {
      handler.post {
        val sel = if (characteristic.uuid == Tiltas.SELECT_UUID && !preparedWrite && offset == 0 && value != null) {
          try { Frames.decodeSelect(value) } catch (e: FrameException) { null }
        } else null
        if (sel != null) {
          selection[device.address] = sel
          readCache.remove("${device.address}/${Tiltas.CHUNK_UUID}")
        }
        if (responseNeeded) {
          server?.sendResponse(device, requestId, if (sel != null) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH, 0, null)
        }
      }
    }
  }

  // ---- Client (central) side -----------------------------------------------------

  private fun scanSettings() = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build()

  private fun startScanning() {
    if (scanning) return
    val scanner = adapter?.bluetoothLeScanner ?: return
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(Tiltas.SERVICE_UUID)).build())
    scanner.startScan(filters, scanSettings(), scanCallback)
    scanning = true
    handler.removeCallbacks(rescan)
    handler.postDelayed(rescan, MeshLimits.RESCAN_MS)
  }

  /** Android stops long-running unfiltered scans and throttles restarts (5 per 30 s); one restart per 30 s is safe. */
  private val rescan: Runnable = object : Runnable {
    override fun run() {
      if (!running || bluetoothState() != "on") return
      if (session == null) {
        try {
          adapter?.bluetoothLeScanner?.stopScan(scanCallback)
          scanning = false
          startScanning()
        } catch (e: Exception) {
          Log.w(TAG, "rescan", e)
        }
      }
      handler.postDelayed(this, MeshLimits.RESCAN_MS)
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      handler.post { discovered(result.device) }
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>) {
      handler.post { results.forEach { discovered(it.device) } }
    }

    override fun onScanFailed(errorCode: Int) {
      Log.w(TAG, "scan failed: $errorCode")
      handler.post { scanning = false }
    }
  }

  private fun discovered(device: BluetoothDevice) {
    peersSeen.add(device.address)
    if (!running || session != null) return
    cooldown[device.address]?.let { if (it > System.currentTimeMillis()) return }
    val s = Session(device)
    session = s
    s.gatt = device.connectGatt(app, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    handler.postDelayed({ if (session === s && !s.connected) fail(s, "connect timeout") }, MeshLimits.CONNECT_TIMEOUT_MS)
    handler.postDelayed({ if (session === s) fail(s, "session timeout") }, MeshLimits.SESSION_TIMEOUT_MS)
    Log.i(TAG, "session: connect ${device.address}")
    emitStatus()
  }

  private fun fail(s: Session, why: String) {
    if (session !== s) return
    Log.i(TAG, "session: $why")
    finish(failed = true)
  }

  private fun finish(failed: Boolean) {
    val s = session ?: return
    session = null
    cooldown[s.device.address] = System.currentTimeMillis() + if (failed) MeshLimits.PENALTY_MS else MeshLimits.COOLDOWN_MS
    try {
      s.gatt?.disconnect()
      s.gatt?.close()
    } catch (e: Exception) {
      Log.w(TAG, "close", e)
    }
    sessions++
    if (!failed) lastSync = System.currentTimeMillis()
    Log.i(TAG, "session: ${if (failed) "failed" else "done"}, fetched ${s.fetched}")
    emitStatus()
  }

  private fun next(s: Session) {
    if (s.fetched >= MeshLimits.FETCHES_PER_SESSION || inbox.size >= MeshLimits.INBOX || s.plan.isEmpty()) {
      return finish(failed = false)
    }
    s.current = s.plan.removeFirst()
    s.chunks.clear()
    select(s, 0)
  }

  private fun select(s: Session, index: Int) {
    val entry = s.current ?: throw FrameException("no selection")
    val ch = s.select ?: throw FrameException("no select characteristic")
    val frame = Frames.encodeSelect(entry.key, index)
    val ok = if (Build.VERSION.SDK_INT >= 33) {
      s.gatt?.writeCharacteristic(ch, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      ch.value = frame
      ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      @Suppress("DEPRECATION")
      s.gatt?.writeCharacteristic(ch) == true
    }
    if (!ok) throw FrameException("write failed")
  }

  private fun read(s: Session, ch: BluetoothGattCharacteristic?) {
    if (ch == null || s.gatt?.readCharacteristic(ch) != true) throw FrameException("read failed")
  }

  private fun handleInventory(s: Session, value: ByteArray) {
    val t = nowSec()
    s.plan = ArrayDeque(Frames.decodeInventory(value).filter { it.expires > t && !holds(it.key) }.sortedWith(InventoryEntry.URGENCY))
    Log.i(TAG, "session: inventory, ${s.plan.size} missing")
    next(s)
  }

  private fun handleChunk(s: Session, value: ByteArray) {
    val entry = s.current ?: throw FrameException("unexpected chunk")
    val c = Frames.decodeChunk(value)
    if (c.total == 0) {
      if (s.chunks.isNotEmpty()) throw FrameException("chunk vanished")
      return next(s) // gone since the inventory was read
    }
    if (c.index != s.chunks.size || (s.chunks.isNotEmpty() && s.chunks[0].total != c.total)) throw FrameException("chunk out of order")
    s.chunks.add(c)
    if (s.chunks.size < c.total) return select(s, s.chunks.size)
    val envelope = Frames.reassemble(s.chunks)
    Frames.checkEnvelope(envelope, entry.key)
    inbox.add(entry.key to envelope)
    received++
    s.fetched++
    save()
    onInbox?.invoke(inbox.size)
    emitStatus()
    next(s)
  }

  /** Run a session step; any protocol error fails the session with the long cool-down. */
  private fun step(s: Session, block: () -> Unit) {
    if (session !== s) return
    try {
      block()
    } catch (e: Exception) {
      fail(s, e.message ?: e.toString())
    }
  }

  private fun sessionFor(gatt: BluetoothGatt): Session? = session?.takeIf { it.gatt === gatt || it.device.address == gatt.device.address }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      handler.post {
        val s = sessionFor(gatt) ?: return@post gatt.close()
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
          s.connected = true
          s.gatt = gatt
          if (!gatt.requestMtu(MeshLimits.MTU)) gatt.discoverServices()
        } else {
          fail(s, "disconnected ($status)")
        }
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      handler.post { sessionFor(gatt)?.let { s -> step(s) { if (!gatt.discoverServices()) throw FrameException("discovery failed") } } }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      handler.post {
        val s = sessionFor(gatt) ?: return@post
        step(s) {
          val service = gatt.getService(Tiltas.SERVICE_UUID)
          if (status != BluetoothGatt.GATT_SUCCESS || service == null) throw FrameException("no Tiltas service")
          s.inventory = service.getCharacteristic(Tiltas.INVENTORY_UUID)
          s.select = service.getCharacteristic(Tiltas.SELECT_UUID)
          s.chunk = service.getCharacteristic(Tiltas.CHUNK_UUID)
          if (s.inventory == null || s.select == null || s.chunk == null) throw FrameException("missing characteristic")
          read(s, s.inventory)
        }
      }
    }

    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      handler.post { handleRead(gatt, characteristic.uuid, value, status) }
    }

    @Deprecated("Android 12 and lower")
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (Build.VERSION.SDK_INT >= 33) return
      @Suppress("DEPRECATION")
      val value = characteristic.value ?: ByteArray(0)
      handler.post { handleRead(gatt, characteristic.uuid, value, status) }
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      handler.post {
        val s = sessionFor(gatt) ?: return@post
        step(s) {
          if (status != BluetoothGatt.GATT_SUCCESS) throw FrameException("write status $status")
          read(s, s.chunk)
        }
      }
    }
  }

  private fun handleRead(gatt: BluetoothGatt, uuid: java.util.UUID, value: ByteArray, status: Int) {
    val s = sessionFor(gatt) ?: return
    step(s) {
      if (status != BluetoothGatt.GATT_SUCCESS) throw FrameException("read status $status")
      when (uuid) {
        Tiltas.INVENTORY_UUID -> handleInventory(s, value)
        Tiltas.CHUNK_UUID -> handleChunk(s, value)
      }
    }
  }
}

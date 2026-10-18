// Tiltas mesh engine over CoreBluetooth (iOS and macOS): serves verified
// alerts as a GATT peripheral and fetches missing ones as a central
// (packages/tiltas/SPEC.md §3, §5). It never verifies or relays what it
// fetches: received envelopes wait in the inbox until the app has verified
// them and handed them back through `setOffers`.

import CoreBluetooth
import Foundation

public struct Offer: Codable, Equatable {
  public var key: Data
  public var priority: UInt8
  public var expires: UInt32
  public var envelope: Data

  var entry: InventoryEntry { InventoryEntry(key: key, priority: priority, expires: expires) }
}

public struct MeshStatus: Equatable {
  /// idle | unknown | resetting | unsupported | unauthorized | off | on
  public var bluetooth: String
  public var running: Bool
  public var served: Int
  public var inbox: Int
  public var peersSeen: Int
  public var sessions: Int
  public var received: Int
  public var lastSync: Date?
}

public enum MeshLimits {
  public static let served = Tiltas.maxInventory
  public static let inbox = 16
  public static let fetchesPerSession = 8
  public static let cooldown: TimeInterval = 60
  public static let penalty: TimeInterval = 300
  public static let reject: TimeInterval = 3600
  public static let connectTimeout: TimeInterval = 10
  public static let sessionTimeout: TimeInterval = 20
  public static let rescanInterval: TimeInterval = 30
}

private let serviceID = CBUUID(string: Tiltas.serviceUUID)
private let inventoryID = CBUUID(string: Tiltas.inventoryUUID)
private let selectID = CBUUID(string: Tiltas.selectUUID)
private let chunkID = CBUUID(string: Tiltas.chunkUUID)

private struct SavedState: Codable {
  var served: [Offer]
  var inbox: [Data]
}

/// One central-side sync session against one peer.
private final class Session {
  let peripheral: CBPeripheral
  var inventory: CBCharacteristic?
  var select: CBCharacteristic?
  var chunk: CBCharacteristic?
  var plan: [InventoryEntry] = []
  var current: InventoryEntry?
  var chunks: [Chunk] = []
  var fetched = 0
  var timers: [DispatchWorkItem] = []

  init(_ peripheral: CBPeripheral) { self.peripheral = peripheral }
}

public final class MeshEngine: NSObject {
  public var onStatus: ((MeshStatus) -> Void)?
  public var onInbox: ((Int) -> Void)?
  public var log: ((String) -> Void)?

  private let queue = DispatchQueue(label: "com.balticbot.tiltas")
  private let stateURL: URL
  private var central: CBCentralManager?
  private var peripheral: CBPeripheralManager?
  private var running = false

  private var served: [Offer] = []
  private var inbox: [(key: Data, envelope: Data)] = []
  private var rejected: [Data: Date] = [:]
  private var cooldown: [UUID: Date] = [:]
  private var peersSeen = Set<UUID>()
  private var sessions = 0
  private var received = 0
  private var lastSync: Date?

  private var serviceAdded = false
  private var selection: [UUID: (key: Data, index: Int)] = [:]
  /// Value returned at offset 0 of a long read, kept for the follow-up offsets.
  private var readCache: [String: Data] = [:]

  private var session: Session?
  private var rescanTimer: DispatchSourceTimer?

  public init(stateDirectory: URL) {
    stateURL = stateDirectory.appendingPathComponent("tiltas-state.json")
    super.init()
    try? FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
    if let data = try? Data(contentsOf: stateURL), let saved = try? JSONDecoder().decode(SavedState.self, from: data) {
      served = saved.served
      inbox = saved.inbox.compactMap { env in (try? Frames.envelopeBody(env)).map { (Frames.meshKey($0), env) } }
    }
  }

  // MARK: Public API (thread-safe)

  /// Creates the Bluetooth managers on first use, which shows the permission prompt.
  public func start() {
    queue.async {
      self.running = true
      if self.central == nil {
        self.central = CBCentralManager(delegate: self, queue: self.queue)
        self.peripheral = CBPeripheralManager(delegate: self, queue: self.queue)
      } else {
        self.startScanning()
        self.startAdvertising()
      }
      self.emitStatus()
    }
  }

  public func stop() {
    queue.async {
      self.running = false
      self.rescanTimer?.cancel()
      self.rescanTimer = nil
      if self.central?.state == .poweredOn { self.central?.stopScan() }
      if self.peripheral?.state == .poweredOn {
        self.peripheral?.stopAdvertising()
        self.peripheral?.removeAllServices()
      }
      self.serviceAdded = false
      if self.session != nil { self.finish(failed: false) }
      self.emitStatus()
    }
  }

  /// Replace the served set with alerts the app has verified. Envelopes
  /// without the alert-envelope shape are ignored; keys are recomputed here.
  public func setOffers(_ offers: [(envelope: Data, priority: UInt8, expires: UInt32)]) {
    queue.async {
      self.served = offers.compactMap { o in
        guard o.priority <= Tiltas.maxPriority, let body = try? Frames.envelopeBody(o.envelope) else { return nil }
        return Offer(key: Frames.meshKey(body), priority: o.priority, expires: o.expires, envelope: o.envelope)
      }
      self.pruneServed()
      let keys = Set(self.served.map(\.key))
      self.inbox.removeAll { keys.contains($0.key) }
      self.save()
      self.emitStatus()
    }
  }

  /// Hand the unverified envelopes to the app and clear the inbox.
  public func drainInbox() -> [Data] {
    queue.sync {
      let out = inbox.map(\.envelope)
      inbox.removeAll()
      save()
      emitStatus()
      return out
    }
  }

  /// Keys whose alerts failed verification: not fetched again for an hour.
  public func markRejected(_ keys: [Data]) {
    queue.async {
      let now = Date()
      for k in keys where k.count == Tiltas.keyBytes { self.rejected[k] = now }
    }
  }

  public func status() -> MeshStatus {
    queue.sync { currentStatus() }
  }

  // MARK: Store

  private func now() -> UInt32 { UInt32(clamping: Int(Date().timeIntervalSince1970)) }

  private func pruneServed() {
    let t = now()
    served.removeAll { $0.expires <= t }
    var seen = Set<Data>()
    served = served.sorted { InventoryEntry.moreUrgent($0.entry, $1.entry) }.filter { seen.insert($0.key).inserted }
    if served.count > MeshLimits.served { served = Array(served.prefix(MeshLimits.served)) }
  }

  private func holds(_ key: Data) -> Bool {
    if let at = rejected[key], Date().timeIntervalSince(at) >= MeshLimits.reject { rejected[key] = nil }
    return rejected[key] != nil || served.contains { $0.key == key } || inbox.contains { $0.key == key }
  }

  private func save() {
    let state = SavedState(served: served, inbox: inbox.map(\.envelope))
    guard let data = try? JSONEncoder().encode(state) else { return }
    try? data.write(to: stateURL, options: [.atomic])
  }

  private func bluetoothState() -> String {
    guard let c = central else { return "idle" }
    switch c.state {
    case .poweredOn: return "on"
    case .poweredOff: return "off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  private func currentStatus() -> MeshStatus {
    MeshStatus(
      bluetooth: bluetoothState(), running: running, served: served.count, inbox: inbox.count,
      peersSeen: peersSeen.count, sessions: sessions, received: received, lastSync: lastSync)
  }

  private func emitStatus() { onStatus?(currentStatus()) }

  // MARK: Peripheral side

  private func startAdvertising() {
    guard running, let p = peripheral, p.state == .poweredOn else { return }
    if !serviceAdded {
      let service = CBMutableService(type: serviceID, primary: true)
      service.characteristics = [
        CBMutableCharacteristic(type: inventoryID, properties: [.read], value: nil, permissions: [.readable]),
        CBMutableCharacteristic(type: selectID, properties: [.write], value: nil, permissions: [.writeable]),
        CBMutableCharacteristic(type: chunkID, properties: [.read], value: nil, permissions: [.readable]),
      ]
      serviceAdded = true
      p.add(service) // advertising starts in didAdd
    } else if !p.isAdvertising {
      p.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceID]])
    }
  }

  private func readValue(for characteristic: CBUUID, central: UUID) -> Data? {
    switch characteristic {
    case inventoryID:
      pruneServed()
      return try? Frames.encodeInventory(served.map(\.entry))
    case chunkID:
      guard let sel = selection[central], let offer = served.first(where: { $0.key == sel.key }) else { return Frames.notAvailable }
      return Frames.encodeChunk(offer.envelope, index: sel.index)
    default:
      return nil
    }
  }

  // MARK: Central side

  private func startScanning() {
    guard running, let c = central, c.state == .poweredOn else { return }
    c.scanForPeripherals(withServices: [serviceID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    if rescanTimer == nil {
      // Without duplicates each peer is reported once per scan; restarting
      // the scan lets peers past their cool-down be met again.
      let t = DispatchSource.makeTimerSource(queue: queue)
      t.schedule(deadline: .now() + MeshLimits.rescanInterval, repeating: MeshLimits.rescanInterval)
      t.setEventHandler { [weak self] in
        guard let self, self.running, self.session == nil, self.central?.state == .poweredOn else { return }
        self.central?.stopScan()
        self.central?.scanForPeripherals(withServices: [serviceID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
      }
      t.resume()
      rescanTimer = t
    }
  }

  private func begin(_ p: CBPeripheral) {
    let s = Session(p)
    session = s
    p.delegate = self
    schedule(s, after: MeshLimits.connectTimeout) { s.inventory == nil }
    schedule(s, after: MeshLimits.sessionTimeout) { true }
    central?.connect(p)
    log?("session: connect \(p.identifier)")
  }

  /// Fail the session after `delay` if it is still running and `condition` holds.
  private func schedule(_ s: Session, after delay: TimeInterval, if condition: @escaping () -> Bool) {
    let item = DispatchWorkItem { [weak self] in
      guard let self, self.session === s, condition() else { return }
      self.log?("session: timeout")
      self.finish(failed: true)
    }
    s.timers.append(item)
    queue.asyncAfter(deadline: .now() + delay, execute: item)
  }

  private func finish(failed: Bool) {
    guard let s = session else { return }
    s.timers.forEach { $0.cancel() }
    session = nil
    let id = s.peripheral.identifier
    cooldown[id] = Date().addingTimeInterval(failed ? MeshLimits.penalty : MeshLimits.cooldown)
    if s.peripheral.state != .disconnected { central?.cancelPeripheralConnection(s.peripheral) }
    sessions += 1
    if !failed { lastSync = Date() }
    log?("session: \(failed ? "failed" : "done"), fetched \(s.fetched)")
    emitStatus()
  }

  private func next(_ s: Session) throws {
    guard s.fetched < MeshLimits.fetchesPerSession, inbox.count < MeshLimits.inbox, !s.plan.isEmpty else {
      return finish(failed: false)
    }
    s.current = s.plan.removeFirst()
    s.chunks = []
    try select(s, index: 0)
  }

  private func select(_ s: Session, index: Int) throws {
    guard let entry = s.current, let ch = s.select else { throw FrameError("no selection") }
    s.peripheral.writeValue(try Frames.encodeSelect(key: entry.key, index: index), for: ch, type: .withResponse)
  }

  private func handleInventory(_ s: Session, _ value: Data) throws {
    let t = now()
    s.plan = try Frames.decodeInventory(value)
      .filter { $0.expires > t && !holds($0.key) }
      .sorted(by: InventoryEntry.moreUrgent)
    log?("session: inventory, \(s.plan.count) missing")
    try next(s)
  }

  private func handleChunk(_ s: Session, _ value: Data) throws {
    guard let entry = s.current else { throw FrameError("unexpected chunk") }
    let c = try Frames.decodeChunk(value)
    if c.total == 0 {
      guard s.chunks.isEmpty else { throw FrameError("chunk vanished") }
      return try next(s) // gone since the inventory was read
    }
    guard Int(c.index) == s.chunks.count, s.chunks.first.map({ $0.total == c.total }) ?? true else {
      throw FrameError("chunk out of order")
    }
    s.chunks.append(c)
    if s.chunks.count < Int(c.total) { return try select(s, index: s.chunks.count) }
    let envelope = try Frames.reassemble(s.chunks)
    _ = try Frames.checkEnvelope(envelope, key: entry.key)
    inbox.append((entry.key, envelope))
    received += 1
    s.fetched += 1
    save()
    onInbox?(inbox.count)
    emitStatus()
    try next(s)
  }

  /// Run a session step; any protocol error fails the session with the long cool-down.
  private func step(_ body: () throws -> Void) {
    do { try body() } catch {
      log?("session: \(error)")
      finish(failed: true)
    }
  }
}

// MARK: - CBPeripheralManagerDelegate

extension MeshEngine: CBPeripheralManagerDelegate {
  public func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
    if p.state == .poweredOn {
      startAdvertising()
    } else {
      serviceAdded = false
    }
    emitStatus()
  }

  public func peripheralManager(_ p: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error {
      log?("peripheral: add service failed: \(error)")
      serviceAdded = false
      return
    }
    if running { p.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceID]]) }
  }

  public func peripheralManager(_ p: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    let cacheKey = "\(request.central.identifier)/\(request.characteristic.uuid)"
    let value: Data?
    if request.offset == 0 {
      value = readValue(for: request.characteristic.uuid, central: request.central.identifier)
      readCache[cacheKey] = value
    } else {
      value = readCache[cacheKey]
    }
    guard let value else { return p.respond(to: request, withResult: .attributeNotFound) }
    guard request.offset <= value.count else { return p.respond(to: request, withResult: .invalidOffset) }
    request.value = Data(value.dropFirst(request.offset))
    p.respond(to: request, withResult: .success)
  }

  public func peripheralManager(_ p: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    guard let first = requests.first else { return }
    for r in requests {
      guard r.characteristic.uuid == selectID, r.offset == 0, let v = r.value, let sel = try? Frames.decodeSelect(v) else {
        return p.respond(to: first, withResult: .invalidAttributeValueLength)
      }
      selection[r.central.identifier] = sel
      readCache["\(r.central.identifier)/\(chunkID)"] = nil
    }
    p.respond(to: first, withResult: .success)
  }
}

// MARK: - CBCentralManagerDelegate

extension MeshEngine: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ c: CBCentralManager) {
    if c.state == .poweredOn {
      startScanning()
    } else if session != nil {
      finish(failed: true)
    }
    emitStatus()
  }

  public func centralManager(
    _ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    peersSeen.insert(p.identifier)
    guard running, session == nil else { return }
    if let until = cooldown[p.identifier], until > Date() { return }
    begin(p)
  }

  public func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    guard session?.peripheral === p else { return c.cancelPeripheralConnection(p) }
    p.discoverServices([serviceID])
  }

  public func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    if session?.peripheral === p { finish(failed: true) }
  }

  public func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    if session?.peripheral === p { finish(failed: true) }
  }
}

// MARK: - CBPeripheralDelegate

extension MeshEngine: CBPeripheralDelegate {
  public func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let s = session, s.peripheral === p else { return }
    guard error == nil, let service = p.services?.first(where: { $0.uuid == serviceID }) else { return finish(failed: true) }
    p.discoverCharacteristics([inventoryID, selectID, chunkID], for: service)
  }

  public func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let s = session, s.peripheral === p else { return }
    let chars = service.characteristics ?? []
    s.inventory = chars.first { $0.uuid == inventoryID }
    s.select = chars.first { $0.uuid == selectID }
    s.chunk = chars.first { $0.uuid == chunkID }
    guard error == nil, let inv = s.inventory, s.select != nil, s.chunk != nil else { return finish(failed: true) }
    p.readValue(for: inv)
  }

  public func peripheral(_ p: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let s = session, s.peripheral === p else { return }
    guard error == nil, let value = characteristic.value else { return finish(failed: true) }
    step {
      switch characteristic.uuid {
      case inventoryID: try handleInventory(s, value)
      case chunkID: try handleChunk(s, value)
      default: break
      }
    }
  }

  public func peripheral(_ p: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let s = session, s.peripheral === p, let chunk = s.chunk else { return }
    guard error == nil else { return finish(failed: true) }
    p.readValue(for: chunk)
  }
}

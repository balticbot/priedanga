/** Label glyphs for the map style (Noto Sans, Latin + Latin Extended-A + punctuation). */
export const GLYPH_ASSETS: Record<string, Record<string, number>> = {
  'Noto-Sans-Regular': {
    '0-255': require('../../assets/glyphs/Noto-Sans-Regular/0-255.pbf'),
    '256-511': require('../../assets/glyphs/Noto-Sans-Regular/256-511.pbf'),
    '8192-8447': require('../../assets/glyphs/Noto-Sans-Regular/8192-8447.pbf'),
  },
  'Noto-Sans-Medium': {
    '0-255': require('../../assets/glyphs/Noto-Sans-Medium/0-255.pbf'),
    '256-511': require('../../assets/glyphs/Noto-Sans-Medium/256-511.pbf'),
    '8192-8447': require('../../assets/glyphs/Noto-Sans-Medium/8192-8447.pbf'),
  },
  'Noto-Sans-Italic': {
    '0-255': require('../../assets/glyphs/Noto-Sans-Italic/0-255.pbf'),
    '256-511': require('../../assets/glyphs/Noto-Sans-Italic/256-511.pbf'),
    '8192-8447': require('../../assets/glyphs/Noto-Sans-Italic/8192-8447.pbf'),
  },
};

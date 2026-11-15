// Display names of track `instrumento` values (Playlist lane heads, project history).
export const LANE_NAMES = {
  bateria: 'Drums', drums: 'Drums', piano: 'Piano', bajo: 'Bass', bass: 'Bass', melodia: 'Lead', lead: 'Lead',
  // Sampled instruments from audio.js (FluidR3_GM, see public/samples/CREDITS.md)
  rhodes: 'Rhodes', bajo_electrico: 'Electric bass', bajo_synth: 'Synth bass', pad: 'Pad', vibrafono: 'Vibraphone',
}

// Instruments a new track can have (the "+ Add track" row of the Playlist), with the piece type each one suggests.
export const TRACK_INSTRUMENTS = [
  ['bateria', 'ritmo'],
  ['piano', 'acordes'],
  ['bajo', 'bajo'],
  ['melodia', 'melodia'],
  ['rhodes', 'acordes'],
  ['pad', 'acordes'],
  ['bajo_electrico', 'bajo'],
  ['bajo_synth', 'bajo'],
  ['vibrafono', 'melodia'],
]
// Piece type that fits a track's instrument (English aliases included).
export const TIPO_OF_INSTRUMENTO = { ...Object.fromEntries(TRACK_INSTRUMENTS), drums: 'ritmo', bass: 'bajo', lead: 'melodia' }

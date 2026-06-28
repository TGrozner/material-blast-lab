# Audio Assets

Selected source assets:

- `kenney-impact/`: Kenney Impact Sounds 1.0, https://kenney.nl/assets/impact-sounds
- `kenney-scifi/`: Kenney Sci-Fi Sounds 1.0, https://kenney.nl/assets/sci-fi-sounds
- `sonniss-gdc/`: edited cues from the Sonniss #GameAudioGDC 2021-2023 bundle,
  https://gamesounds.xyz/?dir=Sonniss.com%20-%20GDC%202021-2023%20-%20Game%20Audio%20Bundle

The Kenney packs are distributed under Creative Commons Zero (CC0):
https://creativecommons.org/publicdomain/zero/1.0/

The Sonniss GDC bundle is distributed under the Sonniss #GameAudioGDC Bundle
Licensing Agreement: royalty-free use in commercial interactive projects without
attribution. See `sonniss-gdc/README.md` for the exact source masters used.

Only a small subset of `.ogg` files is included here. The game layers these
samples with WebAudio synthesis in `src/audio.ts` for cannon shots, primary
blasts, material-specific fracture hits, chain impacts, rumble, collapse tails,
and debris beds.

# Anatomy asset attribution

`upper-limb.bin/.json`, `vessels.bin/.json` and `body.bin/.json` are adapted from **BodyParts3D**, © The Database Center for Life Science,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Licence record: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>
- Dataset: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html> (BodyParts3D 4.0, `isa_BP3D_4.0_obj_99.zip`)
- Publication: Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts. <https://doi.org/10.1093/nar/gkn613>
- Taken from the npm package `@dagno/anatomy-model@0.1.2` (CC BY 4.0), which carries the Human Atlas preparation
  (commit f5d5b74: metres, Y up, meshoptimizer simplification within 0.2% error). Its own ATTRIBUTION.md notes that the
  OBJ comments mention an older CC BY-SA 2.1 Japan licence and that the database's current CC BY 4.0 licence supersedes it.
  That licence page was not reachable from the build container; checking it from the laptop is an open item.

Changes made here (tools/build-assets.py, tools/build-body.py):
- Kept only the right upper limb (30 bones, 46 muscles) and, separately, the trunk, head and legs (135 bones, 64 major
  superficial muscles and fascia). The optional vessel payload keeps 39 right hand/forearm arteries and 21 veins. Teeth, cartilage, discs, nerves and organs are dropped.
- Positions quantized to int16 (0.05 mm upper limb, 0.1 mm body). The left arm is the right arm mirrored at run time.
- Each body muscle vertex carries a binding to its two nearest body segments, computed from the nearest bones.
- Five leg structures that the source files under the skeletal system (tibialis anterior, fibularis longus, iliotibial
  tract) are drawn as muscle/fascia.

The overlay is illustrative and not for diagnosis. Show this credit wherever the models appear (the demo page does).
Not used, on purpose: Z-Anatomy (CC BY-SA 4.0) and non-commercial Sketchfab models.

# KAW Livery Wizard

Design your own American Truck Simulator paint jobs inside the Companion and turn them into a real mod. It is free, and everything runs on your PC: drawing, DDS encoding and ZIP packing happen in the browser, and nothing is uploaded.

Open it from **Setup → Livery Wizard** on the PC running the Companion (`http://127.0.0.1:4280`).

## Steps

1. **Details.** Fill in the name, author (Kaw by default), price, unlock level and base colour. Turn on "Let drivers change the base colour" to give players the in-game colour picker.
2. **Vehicles.** Tick the trucks and trailers the paint job is for. There are 34 SCS vehicles (19 trucks, 15 owned trailers).
3. **Paint.** Pick a vehicle and a part, which is a cabin or an accessory such as a sideskirt, trailer body or bumper.
   - **Add layers:**
     - background (solid, linear or radial gradient);
     - stripes (up to 12, with gaps);
     - patterns: camo, carbon fibre, flames, checker or chevrons, all seeded so they come out the same every time;
     - text, with outline and a mirror option for the other side;
     - logos (PNG/JPG/WebP).
   - **On the picture:** drag to move the selected layer. Use the mouse wheel to resize and Shift + wheel to rotate.
   - **Layer list:** each layer has opacity and blend options. You can also reorder, duplicate, hide or delete layers there.
4. **Template.** Load the paint-job template image for that part. SCS does not publish official templates, so use the free community templates, such as Carsmaniac's. The template is drawn over the preview as a guide and is never exported. If its size matches a known texture size, the part switches to that size.
5. **Build.**
   - Each painted part becomes a DXT5 (BC3) DDS with a full mipmap chain.
   - The Wizard also makes the `.tobj` texture objects and the SII/SUI definitions.
   - The mod gets a 256×64 icon and a 276×162 Mod Manager picture.
   - Download the ZIP, or use **Save to ATS mod folder** to put it straight into `Documents\American Truck Simulator\mod` (this only works on the PC itself).
6. **Play.** Enable the mod in the ATS Mod Manager, then buy the paint job at a dealer or service shop. Test it in single player first.

## Projects

- Designs autosave in this browser.
- **Save project file** writes a `.kawlivery.json` file with all layers and logos. Open it again later or share it.
- Template images are not saved. Load them again after a restart.

## AI design helper (free, local)

- Type what you want, for example "black with orange flames, gold pinstripes, KAW TRUCKING", and press **Design it**.
- Your own local AI builds the design as normal layers you can move and tweak. This is the same Ollama your Co-Driver uses, with the model chosen in Co-Driver settings.
- Nothing leaves your PC. If Ollama isn't running, the helper says so.
- **Advanced:** if a Stable Diffusion WebUI image generator happens to be running on this PC, an extra "AI image" option appears. Otherwise it stays hidden; you don't need it.

## Technical notes

- **File layout:** follows Paint Job Packer by Carsmaniac (MIT) and the SCS modding wiki.
  - `manifest.sii` (category `paint_job`)
  - `def/vehicle/<truck|trailer_owned>/<vehicle>/paint_job/<id>_settings.sui`
  - One `accessory_paint_job_data` per cabin, with `suitable_for`.
  - Accessory overrides in `paint_job/accessory/<id>.sii`.
  - Icon material in `material/ui/accessory`.
- **Unit names:** at most 12 characters (`a-z0-9_`), made unique automatically.
- **Texture sizes:** usually 4096×4096 for trucks and 4096×2048 for trailers. You can choose another size per part; match it to your template.
- **Texture format:** DXT5 is used because every ATS version loads it. BC7 is not produced.
- **Vehicle data:** `public/livery/vehicles.json` comes from Paint Job Packer (see `public/livery/VEHICLES-LICENSE.txt`).

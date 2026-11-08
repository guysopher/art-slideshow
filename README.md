# Art Slideshow

A Chrome extension that plays the [Midjourney Explore](https://www.midjourney.com/explore?tab=top) page as a full-screen slideshow.

- Each image stays on screen for 10 seconds.
- Images are never cropped. Empty space around them is pure black.
- Images fade slowly into each other.
- The show loops. It re-reads Explore every 10 minutes, so new images appear on their own.

## Why it is an extension

Midjourney's Cloudflare protection blocks other websites and servers from reading Explore. The extension runs inside your own Chrome, on midjourney.com, with your own session. Nothing is sent anywhere else.

## Install

1. Download this repository: click **Code → Download ZIP** and unzip it, or run `git clone https://github.com/guysopher/art-slideshow.git`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder. You can also drag the folder onto the page.
5. Optional: pin **Art Slideshow** from the puzzle-piece menu so its icon stays in the toolbar.

You need midjourney.com to open normally in that Chrome. If Cloudflare shows a "Just a moment" check, the slideshow starts after the check passes.

## Use

Click the **Art Slideshow** icon in the toolbar. A full-screen window opens and the show starts.

| Key | Action |
| --- | --- |
| → , Space, Enter | Next image |
| ← | Previous image |
| F | Page full screen on/off |

To stop, close the window (⌘W on Mac, Ctrl+W on Windows). The mouse pointer hides after 1.5 seconds without movement.

## Update

After pulling new code, open `chrome://extensions` and click the reload arrow on the **Art Slideshow** card.

## Settings

The constants at the top of [`slideshow.js`](slideshow.js) control the show:

| Constant | Default | Meaning |
| --- | --- | --- |
| `SHOW_MS` | `10000` | Time per image, in milliseconds |
| `FADE_AUTO` | `2.5` | Fade length between images, in seconds |
| `FADE_MANUAL` | `1` | Fade length after a key press, in seconds |
| `FEED` | `top_month` | Explore feed to read (`top_month` is the default Explore tab) |
| `PAGES` | `4` | Pages of 50 images to load (4 = up to 200 images) |
| `REFRESH_MS` | `600000` | How often to re-read Explore, in milliseconds |

Reload the extension after changing them.

## How it works

- `background.js`: the toolbar click opens Explore in a full-screen window. Each time that window loads a midjourney.com page, the extension injects the slideshow into it. Other tabs are left alone.
- `slideshow.js`: reads Explore's own feed (`/api/explore`) with your session, then covers the page with a black overlay that shows the full-size images, two layers crossfading.

If the feed fails three times in a row (for example, the session expired), the page reloads itself and the show restarts.

## Disclaimer

Not affiliated with Midjourney. The images belong to their creators. They are shown from Midjourney's own servers, as on the Explore page.

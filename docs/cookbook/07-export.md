# Export formats

```sh
qgfx render scene.js -o out.mp4                          # H.264
qgfx render scene.js -o out.webm --transparent           # VP9 with alpha
qgfx render scene.js -o out.mov -f mov-prores4444 --transparent
qgfx render scene.js -o out.gif --gif-colors 128
qgfx render scene.js -o frames/ -f png-seq
qgfx still scene.js -o slide.pdf --time 3                # vector PDF of one frame
qgfx still scene.js -o anim.json -f lottie
qgfx still scene.js -o anim.svg -f svg-animated
```

`qgfx formats` lists every format. Long renders are split into chunks (`--chunk`) that resume after an interruption unless you pass `--fresh`, and `--subtitles` writes captions as SRT.

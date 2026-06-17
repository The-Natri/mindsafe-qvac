import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSETS_DIR = path.resolve(__dirname, '..', 'electron', 'assets')

fs.mkdirSync(ASSETS_DIR, { recursive: true })

// Free-to-use nature videos and audio from stable CDN sources
const assets = [
  {
    name: 'intro-forest.mp4',
    url: 'https://videos.pexels.com/video-files/1448735/1448735-uhd_2732_1440_24fps.mp4',
    description: 'Misty forest'
  },
  {
    name: 'intro-waterfall.mp4', 
    url: 'https://videos.pexels.com/video-files/1437396/1437396-uhd_2560_1440_24fps.mp4',
    description: 'Waterfall'
  },
  {
    name: 'intro-mountain.mp4',
    url: 'https://videos.pexels.com/video-files/2169880/2169880-uhd_2560_1440_30fps.mp4',
    description: 'Mountain landscape'
  },
  {
    name: 'bg-music.mp3',
    url: 'https://raw.githubusercontent.com/Everloom-129/RainyBird/main/sounds/birds-forest-morning.mp3',
    description: 'Calm nature ambient music'
  }
]

function download(url, dest) {
  return new Promise((resolve, reject) => {
    // If file exists and has a size larger than 10KB, skip
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10240) {
      console.log(`Already exists and is valid: ${path.basename(dest)}`)
      return resolve()
    }
    const file = fs.createWriteStream(dest)
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }
    https.get(url, options, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close()
        fs.unlinkSync(dest)
        return download(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`Failed to download ${path.basename(dest)}: HTTP Status ${res.statusCode}`))
      }
      const total = parseInt(res.headers['content-length'] || '0')
      let downloaded = 0
      res.on('data', chunk => {
        downloaded += chunk.length
        if (total) process.stdout.write(
          `\r${path.basename(dest)}: ${Math.round(downloaded/total*100)}%`)
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); console.log(''); resolve() })
    }).on('error', reject)
  })
}

console.log('Downloading MindSafe media assets...')
for (const asset of assets) {
  console.log(`\nDownloading ${asset.description}...`)
  try {
    await download(asset.url, path.join(ASSETS_DIR, asset.name))
  } catch (err) {
    console.error(`Error downloading ${asset.name}: ${err.message}`)
  }
}
console.log('\nAll assets checked/downloaded!')

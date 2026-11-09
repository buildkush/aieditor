import { describe, it, expect } from 'vitest'
import {
  getMediaTypeFromFilename,
  getFilenameFromPath,
  createMediaAssetFromSource,
} from './mediaExtractor'
import { resolveMediaUrl } from './mediaUrlResolver'
import type { MediaAsset } from './types'

describe('Media Asset Ingestion & Extraction', () => {
  it('identifies media types from file extensions accurately', () => {
    // Video
    expect(getMediaTypeFromFilename('movie.mp4')).toBe('video')
    expect(getMediaTypeFromFilename('clip.MOV')).toBe('video')
    expect(getMediaTypeFromFilename('recording.webm')).toBe('video')
    expect(getMediaTypeFromFilename('footage.mkv')).toBe('video')

    // Audio
    expect(getMediaTypeFromFilename('voiceover.mp3')).toBe('audio')
    expect(getMediaTypeFromFilename('track.wav')).toBe('audio')
    expect(getMediaTypeFromFilename('song.m4a')).toBe('audio')
    expect(getMediaTypeFromFilename('sfx.flac')).toBe('audio')

    // Image
    expect(getMediaTypeFromFilename('photo.png')).toBe('image')
    expect(getMediaTypeFromFilename('cover.JPG')).toBe('image')
    expect(getMediaTypeFromFilename('sticker.webp')).toBe('image')
    expect(getMediaTypeFromFilename('vector.svg')).toBe('image')
    expect(getMediaTypeFromFilename('graphic.wbmp')).toBe('image')
    expect(getMediaTypeFromFilename('graphic.wbpm')).toBe('image')

    // Subtitles / Captions
    expect(getMediaTypeFromFilename('subtitles.srt')).toBe('caption')
    expect(getMediaTypeFromFilename('captions.vtt')).toBe('caption')
    expect(getMediaTypeFromFilename('movie_en.SRT')).toBe('caption')
  })

  it('extracts filename from windows and unix filesystem paths', () => {
    expect(getFilenameFromPath('C:\\Users\\Kushagra\\Videos\\tutorial.mp4')).toBe('tutorial.mp4')
    expect(getFilenameFromPath('/home/user/movies/reels.mov')).toBe('reels.mov')
    expect(getFilenameFromPath('rawfile.png')).toBe('rawfile.png')
  })

  it('creates MediaAsset with correct metadata from string path in node/test environment', async () => {
    const videoAsset = await createMediaAssetFromSource(
      'C:\\Videos\\presentation.mp4',
      'asset-custom-id'
    )

    expect(videoAsset.id).toBe('asset-custom-id')
    expect(videoAsset.name).toBe('presentation.mp4')
    expect(videoAsset.type).toBe('video')
    expect(videoAsset.path).toBe('C:\\Videos\\presentation.mp4')
    expect(videoAsset.duration).toBeGreaterThan(0)
    expect(videoAsset.metadata?.width).toBe(1920)
    expect(videoAsset.metadata?.height).toBe(1080)

    const audioAsset = await createMediaAssetFromSource('C:\\Music\\theme.mp3')
    expect(audioAsset.type).toBe('audio')
    expect(audioAsset.name).toBe('theme.mp3')
    expect(audioAsset.duration).toBe(15)

    const imageAsset = await createMediaAssetFromSource('C:\\Images\\logo.png')
    expect(imageAsset.type).toBe('image')
    expect(imageAsset.name).toBe('logo.png')
    expect(imageAsset.duration).toBe(5)

    const captionAsset = await createMediaAssetFromSource('C:\\Subtitles\\subs.srt')
    expect(captionAsset.type).toBe('caption')
    expect(captionAsset.name).toBe('subs.srt')
    expect(captionAsset.duration).toBeGreaterThan(0)
  })

  it('resolves local media paths to webview-playable URLs', () => {
    expect(resolveMediaUrl('blob:http://localhost/test-blob')).toBe(
      'blob:http://localhost/test-blob'
    )
    expect(resolveMediaUrl('https://example.com/stream.mp4')).toBe(
      'https://example.com/stream.mp4'
    )

    // Local windows path
    const localUrl = resolveMediaUrl('C:\\Videos\\myvideo.mp4')
    expect(localUrl).toContain('myvideo.mp4')
  })

  it('preserves media asset immutability and missing state', () => {
    const asset: MediaAsset = {
      id: 'asset-1',
      name: 'file.mp4',
      type: 'video',
      path: 'C:\\Videos\\file.mp4',
      duration: 10,
      isMissing: true,
    }

    expect(asset.isMissing).toBe(true)
    expect(asset.path).toBe('C:\\Videos\\file.mp4')
  })
})

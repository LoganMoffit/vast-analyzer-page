const express = require('express');
const cors = require('cors'); // Import CORS
const axios = require('axios');
const xml2js = require('xml2js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();

// Allow CORS from your GitHub Pages URL
app.use(cors({
    origin: 'https://loganmoffit.github.io', // Only allow requests from your GitHub Pages site
}));

app.use(express.json());

// Helper function to download the media file
const downloadMediaFile = async (url, filePath) => {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

// Analyze audio and video bitrates and codecs using FFmpeg
const analyzeMediaFile = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            const result = {
                video: videoStream ? {
                    codec: videoStream.codec_name,
                    bitrate: videoStream.bit_rate ? `${(videoStream.bit_rate / 1000).toFixed(1)} kbps` : "N/A",
                    width: videoStream.width,
                    height: videoStream.height
                } : null,
                audio: audioStream ? {
                    codec: audioStream.codec_name,
                    bitrate: audioStream.bit_rate ? `${(audioStream.bit_rate / 1000).toFixed(1)} kbps` : "N/A",
                    sample_rate: audioStream.sample_rate
                } : null
            };
            resolve(result);
        });
    });
};

app.post('/analyze-vast', async (req, res) => {
    const vastUrl = req.body.url;
    if (!vastUrl) {
        return res.status(400).send("VAST tag URL is required.");
    }

    try {
        // Fetch the VAST XML
        const response = await axios.get(vastUrl);
        const vastXML = response.data;

        // Parse XML to find media file URLs
        const parser = new xml2js.Parser();
        const parsedXML = await parser.parseStringPromise(vastXML);

        const mediaFiles = parsedXML?.VAST?.Ad?.[0]?.InLine?.[0]?.Creatives?.[0]?.Creative?.[0]?.Linear?.[0]?.MediaFiles?.[0]?.MediaFile;
        if (!mediaFiles) {
            return res.status(404).send("No media files found in the VAST tag.");
        }

        // Analyze each media file
        const results = [];
        for (const mediaFile of mediaFiles) {
            const url = mediaFile._.trim();
            const filePath = path.join(__dirname, 'temp_video.mp4');

            // Download and analyze the file
            await downloadMediaFile(url, filePath);
            const analysis = await analyzeMediaFile(filePath);

            results.push({ url, analysis });
            fs.unlinkSync(filePath); // Remove temp file after analysis
        }

        res.json(results);
    } catch (error) {
        console.error("Error analyzing VAST tag:", error);
        res.status(500).send("An error occurred while analyzing the VAST tag.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

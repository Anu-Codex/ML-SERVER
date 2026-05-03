const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve the "uploads" folder so images are accessible via URL
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 1. CONNECT TO DATABASE
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Nexus DB Connected Successfully"))
    .catch(err => console.error("❌ DB Connection Error:", err));

// 2. CONFIGURE IMAGE UPLOAD STORAGE (MULTER)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Creates a unique filename: timestamp-originalName
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 3. DEFINE SCHEMAS & MODELS

// Player Stats Model (Global Rankings)
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({
    name: String,
    profilePic: { type: String, default: "" }, // Field for image path
    wins: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    previousRank: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },      // GS
    goalsAgainst: { type: Number, default: 0 },  // GA
    trophies: { type: String, default: "" }      // Performance
}), 'players');

// Announcement Model
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', new mongoose.Schema({
    message: String,
    date: { type: Date, default: Date.now }
}), 'announcements');

// Tournament Model (Roster, Fixtures, Standings)
const Tournament = mongoose.models.Tournament || mongoose.model('Tournament', new mongoose.Schema({
    title: String,
    totalTeams: String,
    status: String,
    winner: String,
    fixtureLink: String,
    rosterLink: String,
    joinLink: String,
    prize: String,
    date: String,
    tableType: { type: String, default: "Normal" }, // Normal or Group
    roster: [{ 
        teamName: String, 
        players: [String],
        groupName: { type: String, default: "Group A" }
    }],
    fixtures: [{
        stageName: String, 
        matches: [{ 
            p1: String, 
            p2: String, 
            s1: { type: String, default: "-" }, 
            s2: { type: String, default: "-" } 
        }]
    }]
}), 'tournaments');

// Newsletter Model
const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    date: { type: Date, default: Date.now }
}), 'subscribers');

// 4. API ROUTES

// --- GLOBAL RANKINGS & PLAYER MANAGEMENT ---
app.get('/api/rankings', async (req, res) => {
    try {
        const players = await Player.find().sort({ points: -1, wins: -1, goalsFor: -1 });
        res.json(players);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/player-list', async (req, res) => {
    try {
        const players = await Player.find().sort({ name: 1 });
        res.json(players);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create Player (Now supports image upload)
app.post('/api/add-player', upload.single('image'), async (req, res) => {
    try {
        const playerData = { ...req.body };
        if (req.file) {
            playerData.profilePic = `/uploads/${req.file.filename}`;
        }
        const newP = new Player(playerData);
        await newP.save();
        res.json({ success: true, player: newP });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Player Photo specifically
app.post('/api/update-player-photo', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image provided" });
        
        const imagePath = `/uploads/${req.file.filename}`;
        await Player.updateOne({ name: req.body.name }, { $set: { profilePic: imagePath } });
        
        res.json({ success: true, profilePic: imagePath });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SCORING & STATS ---
app.post('/api/update-points', async (req, res) => {
    const { name, result } = req.body;
    let pGain = (result === 'win') ? 3 : (result === 'draw' ? 1 : 0);
    let wGain = (result === 'win') ? 1 : 0;
    try {
        const list = await Player.find().sort({ points: -1, wins: -1 });
        for (let i = 0; i < list.length; i++) {
            await Player.updateOne({ _id: list[i]._id }, { $set: { previousRank: i + 1 } });
        }
        await Player.updateOne({ name }, { $inc: { points: pGain, wins: wGain } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/adjust-points', async (req, res) => {
    try {
        await Player.updateOne({ name: req.body.name }, { $inc: { wins: -req.body.wins, points: -req.body.points } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-trophies', async (req, res) => {
    try {
        await Player.updateOne({ name: req.body.name }, { $set: { trophies: req.body.trophies } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reset-rankings', async (req, res) => {
    try {
        await Player.updateMany({}, { $set: { wins: 0, points: 0, previousRank: 0, goalsFor: 0, goalsAgainst: 0, trophies: "" } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delete-player-safe', async (req, res) => {
    try {
        await Player.findOneAndDelete({ name: req.body.name });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TOURNAMENT CONTROLLER ---
app.get('/api/manage-tournament', async (req, res) => {
    try {
        const tours = await Tournament.find().sort({ _id: -1 });
        res.json(tours);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/manage-tournament', async (req, res) => {
    try {
        const newT = new Tournament(req.body);
        await newT.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/update-tournament', async (req, res) => {
    try {
        await Tournament.findByIdAndUpdate(req.body.id, req.body.data);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/delete-tournament', async (req, res) => {
    try {
        await Tournament.findByIdAndDelete(req.body.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

// --- ROSTER & FIXTURES ---
app.post('/api/update-roster', async (req, res) => {
    const { tourId, teamName, playerName, groupName, action, teamId } = req.body;
    try {
        const tour = await Tournament.findById(tourId);
        if (action === 'add') {
            let team = tour.roster.find(t => t.teamName === teamName);
            if (team) team.players.push(playerName);
            else tour.roster.push({ teamName, players: [playerName], groupName });
        } else if (action === 'remove-team') {
            tour.roster = tour.roster.filter(t => t._id.toString() !== teamId);
        }
        await tour.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-fixtures', async (req, res) => {
    const { tourId, stageId, matchId, action, matchData, stageName } = req.body;
    try {
        const tour = await Tournament.findById(tourId);
        if (action === 'add-stage') {
            tour.fixtures.push({ stageName, matches: [] });
        } else if (action === 'add-match') {
            const stage = tour.fixtures.id(stageId);
            stage.matches.push(matchData);
        } else if (action === 'update-score') {
            const stage = tour.fixtures.id(stageId);
            const match = stage.matches.id(matchId);
            
            const g1 = parseInt(matchData.s1) || 0;
            const g2 = parseInt(matchData.s2) || 0;

            await Player.updateOne({ name: match.p1 }, { $inc: { goalsFor: g1, goalsAgainst: g2 } });
            await Player.updateOne({ name: match.p2 }, { $inc: { goalsFor: g2, goalsAgainst: g1 } });

            match.s1 = matchData.s1;
            match.s2 = matchData.s2;
        } else if (action === 'delete-stage') {
            tour.fixtures.pull(stageId);
        }
        await tour.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ARENA BROADCAST CENTER ---
app.get('/api/announcement', async (req, res) => {
    try {
        const data = await Announcement.find().sort({ date: -1 });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/announcement', async (req, res) => {
    try {
        await new Announcement({ message: req.body.message }).save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clear-announcements', async (req, res) => {
    try {
        await Announcement.deleteMany({});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- NEWSLETTER & ARENA RESULTS ---
app.get('/api/arena-results', async (req, res) => {
    try {
        const tours = await Tournament.find().sort({ _id: -1 });
        let allMatches = [];
        tours.forEach(tour => {
            if (tour.fixtures) {
                tour.fixtures.forEach(stage => {
                    stage.matches.forEach(m => {
                        allMatches.push({ ...m.toObject(), tournamentTitle: tour.title, stageName: stage.stageName, tourStatus: tour.status });
                    });
                });
            }
        });
        res.json(allMatches.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/subscribe', async (req, res) => {
    try {
        const newSub = new Subscriber({ email: req.body.email });
        await newSub.save();
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "Email already exists" }); }
});

app.get('/api/subscribers', async (req, res) => {
    try {
        const list = await Subscriber.find().sort({ date: -1 });
        res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Nexus Server Running on Port ${PORT}`);
});

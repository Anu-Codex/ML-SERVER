const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json()); // This is required to read JSON data

// 1. CONNECT TO DATABASE
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Mystic DB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// 2. SCHEMAS & MODELS
// 1. UPDATE THE PLAYER MODEL
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String }, // ADD THIS to satisfy the old index
    profilePic: { type: String, default: "" },
    wins: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    previousRank: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },
    goalsAgainst: { type: Number, default: 0 },
    trophies: { type: String, default: "" }
}), 'players');



const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', new mongoose.Schema({ message: String, date: { type: Date, default: Date.now } }), 'announcements');

const Tournament = mongoose.models.Tournament || mongoose.model('Tournament', new mongoose.Schema({
    title: String,
    totalTeams: String,
    status: String,
    winner: String,
    joinLink: String,
    date: String,
    tableType: { type: String, default: "Normal" },
    roster: [{ teamName: String, players: [String] }],
    fixtures: [{ stageName: String, matches: [{ p1: String, p2: String, s1: { type: String, default: "-" }, s2: { type: String, default: "-" } }] }]
}), 'tournaments');

const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', new mongoose.Schema({ email: { type: String, unique: true, required: true }, date: { type: Date, default: Date.now } }), 'subscribers');

// 3. API ROUTES

// --- PLAYER SYSTEM (FIXED) ---
// 2. UPDATE THE ADD-PLAYER ROUTE
app.post('/api/add-player', async (req, res) => {
    try {
        const { name, profilePic } = req.body;
        if (!name) return res.status(400).json({ success: false, error: "Name is required" });

        const newP = new Player({
            name: name,
            username: name, // This fixes the E11000 error by giving it a unique value
            profilePic: profilePic || "",
            wins: 0, points: 0, previousRank: 0, goalsFor: 0, goalsAgainst: 0, trophies: ""
        });

        await newP.save();
        res.json({ success: true });
    } catch (err) {
        // If it still fails, tell us why
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/rankings', async (req, res) => {
    try { const players = await Player.find().sort({ points: -1, wins: -1, goalsFor: -1 }); res.json(players); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/player-list', async (req, res) => {
    try { const players = await Player.find().sort({ name: 1 }); res.json(players); } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.post('/api/update-trophies', async (req, res) => {
    try { await Player.updateOne({ name: req.body.name }, { $set: { trophies: req.body.trophies } }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delete-player-safe', async (req, res) => {
    try { await Player.findOneAndDelete({ name: req.body.name }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reset-rankings', async (req, res) => {
    try { await Player.updateMany({}, { $set: { wins: 0, points: 0, previousRank: 0, goalsFor: 0, goalsAgainst: 0, trophies: "" } }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TOURNAMENT SYSTEM ---
app.get('/api/manage-tournament', async (req, res) => {
    try { const tours = await Tournament.find().sort({ _id: -1 }); res.json(tours); } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/manage-tournament', async (req, res) => {
    try { const newT = new Tournament(req.body); await newT.save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/update-tournament', async (req, res) => {
    try { await Tournament.findByIdAndUpdate(req.body.id, req.body.data); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/delete-tournament', async (req, res) => {
    try { await Tournament.findByIdAndDelete(req.body.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed" }); }
});

// --- ROSTER & FIXTURES ---
app.post('/api/update-roster', async (req, res) => {
    const { tourId, teamName, playerName, action, teamId } = req.body;
    try {
        const tour = await Tournament.findById(tourId);
        if (action === 'add') {
            let team = tour.roster.find(t => t.teamName === teamName);
            if (team) team.players.push(playerName);
            else tour.roster.push({ teamName, players: [playerName] });
        } else if (action === 'remove-team') {
            tour.roster = tour.roster.filter(t => t._id.toString() !== teamId);
        }
        await tour.save(); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-fixtures', async (req, res) => {
    const { tourId, stageId, matchId, action, matchData, stageName } = req.body;
    try {
        const tour = await Tournament.findById(tourId);
        if (action === 'add-stage') tour.fixtures.push({ stageName, matches: [] });
        else if (action === 'add-match') tour.fixtures.id(stageId).matches.push(matchData);
        else if (action === 'update-score') {
            const stage = tour.fixtures.id(stageId);
            const match = stage.matches.id(matchId);
            const g1 = parseInt(matchData.s1) || 0;
            const g2 = parseInt(matchData.s2) || 0;
            await Player.updateOne({ name: match.p1 }, { $inc: { goalsFor: g1, goalsAgainst: g2 } });
            await Player.updateOne({ name: match.p2 }, { $inc: { goalsFor: g2, goalsAgainst: g1 } });
            match.s1 = matchData.s1; match.s2 = matchData.s2;
        } else if (action === 'delete-stage') tour.fixtures.pull(stageId);
        await tour.save(); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ANNOUNCEMENTS & NEWS ---
app.get('/api/announcement', async (req, res) => {
    try { const data = await Announcement.find().sort({ date: -1 }); res.json(data); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/announcement', async (req, res) => {
    try { await new Announcement({ message: req.body.message }).save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    try { const newSub = new Subscriber({ email: req.body.email }); await newSub.save(); res.json({ success: true }); } catch (err) { res.status(400).json({ error: "Email already exists" }); }
});

app.get('/api/subscribers', async (req, res) => {
    try { const list = await Subscriber.find().sort({ date: -1 }); res.json(list); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Mystic Server Running on Port ${PORT}`));

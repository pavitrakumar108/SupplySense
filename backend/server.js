const express = require('express');
const cors = require('cors');
const { db, initializeDb } = require('./db');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Initialize database
initializeDb().then(() => {
    console.log('Database initialized successfully.');
}).catch(err => {
    console.error('Database initialization failed:', err);
});

// API: Get all categories
app.get('/api/categories', (req, res) => {
    db.all("SELECT * FROM categories", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Get all products
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Get products by category
app.get('/api/products/:categoryId', (req, res) => {
    const categoryId = req.params.categoryId;
    db.all("SELECT * FROM products WHERE category_id = ?", [categoryId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

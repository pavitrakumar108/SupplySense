const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initializeDb = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Categories Table
            db.run(`CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT
            )`);

            // Products Table
            db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                category_id INTEGER,
                image_url TEXT,
                description TEXT,
                FOREIGN KEY (category_id) REFERENCES categories (id)
            )`);

            // Seed Categories
            db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
                if (row.count === 0) {
                    const categories = [
                        ['Electronics & Gadgets', 'Latest in tech'],
                        ['Home & Kitchen', 'Everything for your home'],
                        ['Fashion & Apparel', 'Trendy clothing']
                    ];
                    const stmt = db.prepare("INSERT INTO categories (name, description) VALUES (?, ?)");
                    categories.forEach(cat => stmt.run(cat));
                    stmt.finalize();
                }

                // Seed Products
                db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
                    if (row.count === 0) {
                        const products = [
                            ['Smart Watch Series 7', 299.99, 1, 'https://images.unsplash.com/photo-1546868871-7041f2a55a31?w=500', 'Latest health tracking'],
                            ['Noise Cancelling Headphones', 199.99, 1, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500', 'Crystal clear sound'],
                            ['Air Fryer Pro', 129.99, 2, 'https://images.unsplash.com/photo-1584947897742-5736392364d9?w=500', 'Healthy frying'],
                            ['Cotton T-Shirt', 25.00, 3, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500', '100% Organic cotton'],
                            ['Leather Wallet', 45.00, 3, 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=500', 'Genuine leather'],
                            ['Coffee Maker', 89.99, 2, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=500', 'Perfect morning brew']
                        ];
                        const stmt = db.prepare("INSERT INTO products (name, price, category_id, image_url, description) VALUES (?, ?, ?, ?, ?)");
                        products.forEach(prod => stmt.run(prod));
                        stmt.finalize();
                    }
                    resolve();
                });
            });
        });
    });
};

module.exports = { db, initializeDb };

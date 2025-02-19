const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const requestIp = require('request-ip');

const app = express();
const port = 3000;

const db = new sqlite3.Database('./pastes.sqlite');
db.run(`
    CREATE TABLE IF NOT EXISTS pastes (
        id TEXT PRIMARY KEY,
        content TEXT,
        ip_address TEXT
    )
`);

app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

function escapeHtml(str) {
    return str.replace(/[&<>"'`=\/]/g, function (match) {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '`': '&#x60;',
            '=': '&#x3D;',
            '/': '&#x2F;'
        })[match];
    });
}

app.post('/api/save', (req, res) => {
    const { content } = req.body;
    const clientIp = requestIp.getClientIp(req);

    if (!content || content.trim() === '') {
        return res.status(400).json({ success: false, message: 'Content cannot be empty' });
    }

    let userId = req.cookies.user_id;
    if (!userId) {
        userId = crypto.createHash('sha256').update(clientIp).digest('hex');
        res.cookie('user_id', userId, { maxAge: 86400000, httpOnly: true });
    }

    const id = crypto.randomBytes(4).toString('hex');
    db.run('INSERT INTO pastes (id, content, ip_address) VALUES (?, ?, ?)', [id, content, clientIp], (err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Failed to save paste' });
        }

        res.json({ success: true, url: `/paste/${id}`, rawUrl: `/raw/${id}`, userId });
    });
});

app.get('/paste/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT content FROM pastes WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).send('<h1>Paste not found</h1>');
        }

        res.send(`
            <html>
            <head>
                <title>Pistebin</title>
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        background-color: #f4f7fb;
                        color: #333;
                    }
                    .container {
                        max-width: 900px;
                        margin: 30px auto;
                        background-color: #ffffff;
                        padding: 40px;
                        border-radius: 12px;
                        box-shadow: 0 12px 20px rgba(0, 0, 0, 0.1);
                    }
                    h2 {
                        text-align: center;
                        font-size: 30px;
                        color: #2c6bed;
                        margin-bottom: 20px;
                    }
                    pre {
                        white-space: pre-wrap;
                        word-wrap: break-word;
                        background: #f7f7f7;
                        padding: 20px;
                        border-radius: 10px;
                        font-size: 18px;
                        color: #444;
                        border: 1px solid #ddd;
                    }
                    .btn-container {
                        text-align: center;
                        margin-top: 20px;
                    }
                    .btn {
                        background-color: #2c6bed;
                        color: white;
                        padding: 12px 24px;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        text-decoration: none;
                        font-size: 16px;
                        transition: background-color 0.3s ease, transform 0.3s ease;
                    }
                    .btn:hover {
                        background-color: #1d4a99;
                        transform: scale(1.05);
                    }
                    .copy-btn {
                        background-color: #2c6bed;
                        margin-right: 15px;
                    }
                    .copy-btn:hover {
                        background-color: #1d4a99;
                        transform: scale(1.05);
                    }
                    .copy-message {
                        display: none;
                        margin-top: 10px;
                        color: #2c6bed;
                        font-size: 16px;
                        text-align: center;
                    }
                    .loading {
                        display: none;
                        text-align: center;
                        margin-top: 20px;
                    }
                    .loading:before {
                        content: '⏳';
                        font-size: 30px;
                        animation: spin 1s infinite linear;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    @media (max-width: 768px) {
                        .container {
                            padding: 30px;
                        }
                        .btn {
                            width: 100%;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>Your Paste</h2>
                    <div class="btn-container">
                        <a href="${req.protocol}://${req.get('host')}/raw/${id}" class="btn">View Raw</a>
                        <button id="copyButton" class="btn copy-btn">Copy to Clipboard</button>
                    </div>
                    <pre id="pasteContent">${escapeHtml(row.content)}</pre>
                    <span id="copyMessage" class="copy-message">Copied to Clipboard!</span>
                    <div id="loading" class="loading"></div>
                </div>
                <script>
                    const copyButton = document.getElementById('copyButton');
                    const copyMessage = document.getElementById('copyMessage');
                    const pasteContent = document.getElementById('pasteContent');
                    const loading = document.getElementById('loading');

                    copyButton.addEventListener('click', () => {
                        loading.style.display = 'block';
                        navigator.clipboard.writeText(pasteContent.innerText).then(() => {
                            loading.style.display = 'none';
                            copyMessage.style.display = 'inline';
                            setTimeout(() => copyMessage.style.display = 'none', 2000);
                        });
                    });
                </script>
            </body>
            </html>
        `);
    });
});

app.get('/raw/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT content FROM pastes WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).send('Paste not found');
        }

        res.set('Content-Type', 'text/plain');
        res.send(row.content);
    });
});

app.get('/history', (req, res) => {
    const clientIp = requestIp.getClientIp(req);

    db.all('SELECT id, content FROM pastes WHERE ip_address = ?', [clientIp], (err, rows) => {
        if (err) {
            return res.status(500).send('Error retrieving history');
        }

        if (rows.length === 0) {
            return res.send(`
                <html>
                <head>
                    <title>History - No Pastes</title>
                    <style>
                        body {
                            font-family: 'Arial', sans-serif;
                            background-color: #f4f7fb;
                            color: #333;
                            margin: 0;
                            padding: 0;
                        }
                        .container {
                            max-width: 900px;
                            margin: 30px auto;
                            background-color: #ffffff;
                            padding: 40px;
                            border-radius: 12px;
                            box-shadow: 0 12px 20px rgba(0, 0, 0, 0.1);
                        }
                        h2 {
                            text-align: center;
                            color: #2c6bed;
                            font-size: 30px;
                            margin-bottom: 20px;
                        }
                        p {
                            text-align: center;
                            font-size: 18px;
                            color: #777;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>Your Paste History</h2>
                        <p>No pastes found.</p>
                    </div>
                </body>
                </html>
            `);
        }

        res.send(`
        <html>
            <head>
                <title>Paste History</title>
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        background-color: #f4f7fb;
                        color: #333;
                        margin: 0;
                        padding: 0;
                    }
                    .container {
                        max-width: 900px;
                        margin: 30px auto;
                        background-color: #ffffff;
                        padding: 40px;
                        border-radius: 12px;
                        box-shadow: 0 12px 20px rgba(0, 0, 0, 0.1);
                    }
                    h2 {
                        text-align: center;
                        color: #2c6bed;
                        font-size: 30px;
                        margin-bottom: 20px;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        padding: 12px;
                        border: 1px solid #ddd;
                        text-align: center;
                        font-size: 16px;
                    }
                    th {
                        background-color: #2c6bed;
                        color: white;
                    }
                    td {
                        background-color: #f9f9f9;
                    }
                    .btn {
                        background-color: #2c6bed;
                        color: white;
                        padding: 8px 16px;
                        border-radius: 5px;
                        cursor: pointer;
                        text-decoration: none;
                    }
                    .btn:hover {
                        background-color: #1d4a99;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>Your Paste History</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr>
                                    <td>${row.id}</td>
                                    <td><a href="/paste/${row.id}" class="btn">View Paste</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});


require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/run-pipeline", async (req, res) => {
    try {
        const response = await axios.post(
            "https://api.github.com/repos/Neutansahu/clouddevops/actions/workflows/ci-cd.yml/dispatches",
            { ref: "main" },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            }
        );

        res.status(202).json({
            success: true,
            message: "GitHub workflow trigger accepted"
        });

    } catch (error) {
        console.error("GitHub error:", error.response?.data || error.message);

        res.status(500).json({
            success: false,
            message: "Workflow could not be triggered"
        });
    }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`CloudDevOps server running on port ${PORT}`);
});

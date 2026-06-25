const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const app = express()
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Hello World!')
})


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const database = client.db("PromptHub-DB");
        const promptsCollection = database.collection("all-prompts");
        const bookmarksCollection = database.collection("bookmarks");
        const subscriptionsCollection = database.collection("subscriptions");
        const userCollection = database.collection("user");


        // Featured Section with limit(6)
        app.get('/api/prompts/featured', async (req, res) => {
            const result = await promptsCollection.find().skip(2).limit(6).toArray();
            res.json(result);
        })

        // Get all prompts
        app.get('/api/prompts', async (req, res) => {
            const result = await promptsCollection.find().toArray();
            res.json(result);
        })

        // Get prompt details + bookmarkColl status checking
        app.get('/api/prompt-details/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const userId = req.query.userId;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid Prompt ID format" });
                }

                const query = {
                    _id: new ObjectId(id)
                };

                const promptResult = await promptsCollection.findOne(query);
                if (!promptResult) {
                    return res.status(404).json({ message: "Prompt not found" });
                }

                let isBookmarked = false;
                const bookmarkQuery = {
                    promptId: id,
                    userId
                };

                if (userId) {
                    const bookmarkExist = await bookmarksCollection.findOne(bookmarkQuery);
                    if (bookmarkExist) {
                        isBookmarked = true;
                    }
                }

                res.json({ ...promptResult, isBookmarked });

            } catch (error) {
                console.error("Error fetching prompt details:", error);
                res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });


        // --------User role related apis [USER DASHBOARD]-------------------

        // User dashboard --> My Prompts
        app.get('/api/my-prompts', async (req, res) => {
            const creatorId = req.query.creatorId;
            const query = {};

            if (creatorId) {
                query.creatorId = creatorId
            }
            const result = await promptsCollection.find(query).toArray();

            res.json(result)
        })

        // User dashboard --> Add Prompt
        app.post('/api/prompts', async (req, res) => {
            const promptData = req.body;
            const newPromptData = {
                ...promptData,
                createdAt: new Date()
            }
            const result = await promptsCollection.insertOne(newPromptData);
            res.json(result);
        })


        // User dashboard --> Bookmarks (toggle)
        app.post("/api/prompts/bookmark", async (req, res) => {
            const bookmarkData = req.body;

            const isExist = await bookmarksCollection.findOne(bookmarkData);
            if (isExist) {
                const result = await bookmarksCollection.deleteOne(bookmarkData)
                return res.json({ message: "Bookmark removed", isBookmarked: false })
            }

            const result = await bookmarksCollection.insertOne(bookmarkData);
            res.json({ message: "Bookmark added", isBookmarked: true })
        })

        // Get bookmarks data from user dashbaord
        app.get("/api/my-bookmark", async (req, res) => {
            const userId = req.query.userId;
            const result = await bookmarksCollection.find({ userId }).toArray()
            // console.log(result)
            res.json(result)
        })

        // Delete bookmark from user dashboard
        app.delete("/api/delete/my-bookmark", async (req, res) => {
            const { bookmarkId } = req.body;
            const query = {
                _id: new ObjectId(bookmarkId)
            }

            const result = await bookmarksCollection.deleteOne(query);
            res.json(result)
        })

        // Increase copy count
        app.patch("/api/prompts/copy-count", async (req, res) => {
            try {
                const { promptId } = req.body;
                const filter = {
                    _id: new ObjectId(promptId)
                }

                const result = await promptsCollection.updateOne(filter, {
                    $inc: { copyCount: 1 }
                })
                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Prompt not found" })
                }

                res.json({ success: true, message: "Copy count updated!" });
            }
            catch (error) {
                console.error("Error updating copy count:", error);
                res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        })

        // Payment to database
        app.post("/api/payment", async (req, res) => {
            try {
                const data = req.body;
                const paymentData = {
                    ...data,
                    createdAt: new Date()
                }
                // add to subscription coll
                const isExist = await subscriptionsCollection.findOne({
                    session_id: data?.session_id
                })
                if (isExist) {
                    return res.json({ success: false, message: "Data already exist" })
                }
                else {
                    const payment = await subscriptionsCollection.insertOne(paymentData);
                }

                // Update user plan free to pro
                const filter = {
                    _id: new ObjectId(data?.userId)
                }
                const updateInfo = {
                    $set: { plan: "pro" }
                }
                const userPlan = await userCollection.updateOne(filter, updateInfo)
                res.json({ success: true, message: "Payment info added" })
            }
            catch (error) {
                console.error("Error when payment data:", error);
                res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
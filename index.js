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
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const JWKS = createRemoteJWKSet(
    new URL(`${process.env.NEXT_PUBLIC_CLIENT_URL}/api/auth/jwks`)
)


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const database = client.db("PromptHub-DB");
        const promptsCollection = database.collection("all-prompts");
        const bookmarksCollection = database.collection("bookmarks");
        const subscriptionsCollection = database.collection("subscriptions");
        const userCollection = database.collection("user");
        const reportCollection = database.collection("reports");
        const reviewCollection = database.collection("reviews");



        // Token Verification Middleware
        const tokenChecker = async (req, res, next) => {
            const authHeader = req.headers;
            const token = authHeader.authorization;

            console.log("✅ authHeader : ", authHeader);
            console.log("💖 Token : ", token);

            next()
        }


        const verifyToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            // console.log("✅ Auth header :", req.headers)
            if (!authHeader) {
                return res.status(401).json({ message: "Unauthorized" })
            }
            const token = authHeader.split(" ")[1];
            if (!token) {
                return res.status(401).json({ message: "Unauthorized" })
            }

            try {
                const { payload } = await jwtVerify(token, JWKS);
                req.user = payload;
                console.log("Verification Payload: ", payload);
                next()
            }
            catch (error) {
                console.log("Error!", error);
                return res.status(401).json({ message: "Unauthorized" })
            }
        }

        const verifyUserRole = async (req, res, next) => {
            const user = req.user;
            if (user?.role !== "user") {
                return res.status(403).json({ message: "Access forbidden" })
            }
            next()
        }

        const verifyCreatorRole = async (req, res, next) => {
            const user = req.user;
            if (user?.role !== "creator") {
                return res.status(403).json({ message: "Access forbidden! You are not CREATOR" })
            }
            next()
        }

        const verifyAdminRole = async (req, res, next) => {
            const user = req.user;
            if (user?.role !== "admin") {
                return res.status(403).json({ message: "Access forbidden! You are not CREATOR" })
            }
            next()
        }


        // Featured Section with limit(6)
        app.get('/api/prompts/featured', async (req, res) => {
            const result = await promptsCollection.find({ isFeatured: true }).skip(2).limit(6).toArray();
            res.json(result);
        })

        // Get all prompts
        app.get('/api/prompts', verifyToken, async (req, res) => {
            const status = req.query.status;

            // TODO : {status: status }
            const result = await promptsCollection.find({ status }).toArray();
            res.json(result || []);
        })

        // Get prompt details + bookmarkColl & reviewsColl status checking
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

                // Bookmark status checking
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

                // Review Status checking
                let isReviewed = false;
                const reviewQuery = {
                    promptId: id,
                    userId
                }
                if (userId) {
                    const reviewExist = await reviewCollection.findOne(reviewQuery)
                    if (reviewExist) {
                        isReviewed = true;
                    }
                }

                // Final response
                res.json({ ...promptResult, isBookmarked, isReviewed });

            } catch (error) {
                console.error("Error fetching prompt details:", error);
                res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });

        // Prompt details page --> Report Prompt
        app.post("/api/report-prompt", async (req, res) => {
            const reportData = req.body;
            const result = await reportCollection.insertOne(reportData);
            res.json(result);
        })

        // Prompt details page --> Submit Review Form
        app.post("/api/prompt-review", async (req, res) => {
            const data = req.body;
            const reviewData = {
                ...data,
                createdAt: new Date()
            }
            const userId = reviewData?.userId;
            const promptId = reviewData?.promptId;

            // User can submit one review per prompt
            const isExist = await reviewCollection.findOne({ userId, promptId });
            if (isExist) {
                return res.json({ isExist: true, message: "You already reviewed!" })
            } else {
                const result = await reviewCollection.insertOne(reviewData);
            }

            // Now need to update the rating count of the prompt
            const filter = { _id: new ObjectId(promptId) }
            const prompt = await promptsCollection.findOne(filter)

            // Rating avg value calculation:
            const rating = reviewData?.rating;  // user review rating
            const ratingSum = prompt?.ratingSum;
            const reviewCount = prompt?.reviewCount;

            // Calculation
            const newRatingSum = ratingSum + rating;
            const newReviewCount = reviewCount + 1;
            const avgRating = newRatingSum / newReviewCount;
            // Rounded number
            const ratingNumber = Number(avgRating.toFixed(1));
            console.log("Updated Rating : ", ratingNumber);

            // Now need to update the rating value of the prompt
            const updatedRating = await promptsCollection.updateOne(filter, {
                $set: {
                    rating: ratingNumber,
                    ratingSum: newRatingSum,
                    reviewCount: newReviewCount
                }
            })

            res.json({ isExist: false, message: "Review submitted." })
        })

        // Prompt details page --> Recent REviews
        app.get("/api/prompt-review", async (req, res) => {
            const promptId = req.query.promptId;

            const result = await reviewCollection.find({ promptId }).toArray();
            res.json(result)
        })

        app.get("/api/prompt-review-public", async (req, res) => {
            const result = await reviewCollection.find().limit(3).toArray();
            res.json(result)
        })

        // Homepage --> Get Top 3 Creators
        app.get("/api/top-creators", async (req, res) => {
            try {
                const topCreators = await promptsCollection.aggregate([
                    {
                        $match: {
                            status: "approved"
                        }
                    },
                    {
                        $group: {
                            _id: "$creatorId",

                            creatorName: {
                                $first: "$creatorName"
                            },

                            creatorEmail: {
                                $first: "$creatorEmail"
                            },

                            totalPromptCount: {
                                $sum: 1
                            },

                            totalCopyCount: {
                                $sum: "$copyCount"
                            }
                        }
                    },
                    {
                        $sort: {
                            totalCopyCount: -1
                        }
                    },
                    {
                        $limit: 3
                    },
                    {
                        $project: {
                            _id: 0,
                            creatorId: "$_id",
                            creatorName: 1,
                            creatorEmail: 1,
                            totalPromptCount: 1,
                            totalCopyCount: 1
                        }
                    }
                ]).toArray();

                res.send(topCreators);

            } catch (error) {
                console.error(error);
                res.status(500).send({
                    message: "Failed to fetch top creators."
                });
            }
        });


        // --------User role related apis [USER DASHBOARD]-------------------

        // User dashboard --> My Prompts
        app.get('/api/my-prompts', verifyToken, async (req, res) => {
            const creatorId = req.query.creatorId;
            const query = {};

            if (creatorId) {
                query.creatorId = creatorId
            }
            const result = await promptsCollection.find(query).toArray();

            res.json(result)
        })

        // User My Prompts --> Prompt Update
        app.patch("/api/data-update/user", verifyToken, verifyUserRole, async (req, res) => {
            try {
                const promptId = req.query.promptId;
                const updatedData = req.body;

                const filter = { _id: new ObjectId(promptId) };
                const updateDoc = {
                    $set: updatedData,
                };

                // Find & Update data
                const result = await promptsCollection.updateOne(filter, updateDoc);

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Prompt not found!"
                    });
                }

                res.send({
                    success: true,
                    message: "Prompt updated successfully!",
                    result
                });

            } catch (error) {
                console.error("Error updating prompt:", error);
                res.status(500).send({
                    success: false,
                    message: "Internal server error",
                    error: error.message
                });
            }
        });

        // Creator My Prompts --> Prompt Delete
        app.delete("/api/data-delete/user", verifyToken, verifyUserRole, async (req, res) => {
            const promptId = req.query.promptId;
            const filter = {
                _id: new ObjectId(promptId)
            }

            const result = await promptsCollection.deleteOne(filter);
            res.json({ success: true, message: "Data deleted", result })
        })

        // User dashboard --> Add Prompt
        app.post('/api/prompts', verifyToken, verifyUserRole, async (req, res) => {
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
            const promptId = req.query.promptId;
            const filter = {
                _id: new ObjectId(promptId)
            }

            const isExist = await bookmarksCollection.findOne(bookmarkData);
            // Remove from bookmark & decrement the bookmark count value
            if (isExist) {
                const result = await bookmarksCollection.deleteOne(bookmarkData)
                const bookmarkCount = await promptsCollection.updateOne(filter,
                    {
                        $inc: { bookmarkCount: -1 }
                    }
                )
                return res.json({ message: "Bookmark removed", isBookmarked: false })
            }

            // Add to bookmark & increment the bookmark count value
            const result = await bookmarksCollection.insertOne(bookmarkData);
            const bookmarkCount = await promptsCollection.updateOne(filter,
                {
                    $inc: { bookmarkCount: +1 }
                }
            )
            res.json({ message: "Bookmark added", isBookmarked: true })
        })

        // Get bookmarks data from user dashboard
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

        // User dashboard --> My Reviews
        app.get("/api/dashboard/my-reviews", async (req, res) => {
            const userId = req.query.userId;
            const query = {};
            if (userId) {
                query.userId = userId
            }

            const result = await reviewCollection.find(query).toArray();
            res.json(result);
        })


        // --------Creator role related apis [USER DASHBOARD]-------------------

        // Creator Home Analytics
        app.get("/api/my-prompts-stats", async (req, res) => {
            const creatorId = req.query.creatorId;

            const result = await promptsCollection.aggregate([
                {
                    $match: {
                        creatorId: creatorId
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCopyCount: {
                            $sum: "$copyCount"
                        },
                        totalBookmarkCount: {
                            $sum: "$bookmarkCount"
                        }
                    }
                }
            ]).toArray();

            console.log("Total Counts:", result);

            res.json(result[0] || {
                totalCopyCount: 0,
                totalBookmarkCount: 0
            })
        })

        // Creator add prompt
        app.post('/api/add-prompt-creator', verifyToken, verifyCreatorRole, async (req, res) => {
            const promptData = req.body;

            const newPromptData = {
                ...promptData,
                createdAt: new Date()
            }
            const result = await promptsCollection.insertOne(newPromptData);
            res.json(result);
        })

        // Creator My Prompts --> Prompt Update
        app.patch("/api/data-update/creator", verifyToken, verifyCreatorRole, async (req, res) => {
            try {
                const promptId = req.query.promptId;
                const updatedData = req.body;

                const filter = { _id: new ObjectId(promptId) };
                const updateDoc = {
                    $set: updatedData,
                };

                // Find & Update data
                const result = await promptsCollection.updateOne(filter, updateDoc);

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Prompt not found!"
                    });
                }

                res.send({
                    success: true,
                    message: "Prompt updated successfully!",
                    result
                });

            } catch (error) {
                console.error("Error updating prompt:", error);
                res.status(500).send({
                    success: false,
                    message: "Internal server error",
                    error: error.message
                });
            }
        });

        // Creator My Prompts --> Prompt Delete
        app.delete("/api/data-delete/creator", verifyToken, verifyCreatorRole, async (req, res) => {
            const promptId = req.query.promptId;
            const filter = {
                _id: new ObjectId(promptId)
            }

            const result = await promptsCollection.deleteOne(filter);
            res.json({ success: true, message: "Data deleted", result })
        })


        // --------Admin role related apis [ADMIN DASHBOARD]-------------------

        // All Users ---> Delete user
        app.delete("/api/admin/delete-user", verifyToken, verifyAdminRole, async (req, res) => {
            const userId = req.query.userId;
            const filter = {
                _id: new ObjectId(userId)
            }

            const userResult = await userCollection.deleteOne(filter)
            res.json({ message: "User deleted", userResult })
        })

        // Get all prompts data
        app.get("/api/admin/prompts", tokenChecker, async (req, res) => {
            const result = await promptsCollection.find().toArray();
            res.json(result);
        })

        // User status update | TODO : Rejected message
        app.patch("/api/admin/update-status", verifyToken, verifyAdminRole, async (req, res) => {
            const promptId = req.query.promptId;
            const filter = {
                _id: new ObjectId(promptId)
            }
            const UpdatedStatus = req.query.status;

            const updateResult = await promptsCollection.updateOne(filter, {
                $set: {
                    status: UpdatedStatus
                }
            })

            res.json({ message: "Prompt status updated", updateResult })
        })

        // Delete prompt
        app.delete("/api/admin/delete-prompt", tokenChecker, async (req, res) => {
            const promptId = req.query.promptId;
            const filter = {
                _id: new ObjectId(promptId)
            }

            const deletePrompt = await promptsCollection.deleteOne(filter);
            res.json({ deletePrompt, message: "Prompt deleted" })
        })

        // Update featured
        app.patch("/api/admin/update-featured", async (req, res) => {
            const promptId = req.query.promptId;
            const toggle = req.query.toggle === "true"; // Boolean

            const filter = {
                _id: new ObjectId(promptId)
            };

            const featuredUpdate = await promptsCollection.updateOne(filter, {
                $set: {
                    isFeatured: toggle
                }
            });

            res.json({
                featuredUpdate,
                message: "Featured toggled"
            });
        });



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
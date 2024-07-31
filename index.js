const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());




// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nnvexxr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const uri = `mongodb://localhost:27017`

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
    await client.connect();
    // const database = client.db("Job-Listing");
    const database = client.db("job-listing");
    const userCollection = database.collection("users");
    const jobCollection = database.collection("jobs");

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });


    app.patch('/user/:id', async (req, res) => {
      const userId = req.params.id;
      const updateData = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send('User not found');
        }

        res.send('User info updated successfully');
      } catch (err) {
        console.error('Error updating user info:', err);
        res.status(500).send('Internal Server Error');
      }
    });

    app.patch('/user/:id/education', async (req, res) => {
      const userId = req.params.id;
      const educationData = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      if (!educationData._id) {
        educationData._id = new ObjectId();
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { education: educationData } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send('User not found');
        }

        res.send('Education data added successfully');
      } catch (err) {
        console.error('Error adding education data:', err);
        res.status(500).send('Internal Server Error');
      }
    });


    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    })

    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send(user);
    })




    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne(job);
      res.send(result);
    });

    app.get("/jobs", async (req, res) => {
      try {
        const currentDate = new Date().toISOString();
        console.log(currentDate);
        const query = { deadline: { $gt: currentDate } };
        const jobs = await jobCollection.find(query).toArray();
        res.send(jobs);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });


    app.get('/jobs/featuredJobs', async (req, res) => {

      const topJobs = await jobCollection.find({})
        .sort({ view: -1 })
        .limit(10)
        .toArray();

      res.send(topJobs);
    });

    app.get("/jobs/job/:jobId", async (req, res) => {
      const jobId = req.params.jobId;
      const job = await jobCollection.findOne({ _id: new ObjectId(jobId) });
      res.send(job);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send("Job is listing..............");
})

app.listen(port, () => {
  console.log(`Job listing on port ${port}`);
})
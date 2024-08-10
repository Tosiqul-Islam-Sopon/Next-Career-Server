const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nnvexxr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// const uri = `mongodb://localhost:27017`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, resumesCollection;

client.connect().then(() => {
  db = client.db("Job-Listing");
  // db = client.db("job-listing")
  resumesCollection = db.collection('resumes');
  console.log("Connected to MongoDB and collection initialized");
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') // Specify the directory where files will be saved
  },
  filename: function (req, file, cb) {
    cb(null, `resume_${Date.now()}${path.extname(file.originalname)}`) // Save file with a unique name
  }
});

const upload = multer({ storage });

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const database = client.db("Job-Listing");
    // const database = client.db("job-listing");
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

    app.post('/user/:id/resume', upload.single('resume'), async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      try {
        console.log('Uploaded file:', req.file);
        const resume = {
          userId: new ObjectId(userId),
          filename: req.file.filename,
          path: req.file.path,
          uploadDate: new Date()
        };

        const result = await resumesCollection.insertOne(resume);

        res.send({ message: 'Resume uploaded successfully', resumeId: result.insertedId });
      } catch (err) {
        console.error('Error uploading resume:', err);
        res.status(500).send('Internal Server Error');
      }
    });

    app.patch('/user/:id', async (req, res) => {
      const userId = req.params.id;
      const { name, email, role, ...personalInfo } = req.body; // Destructure the data from the request body

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      try {
        // Build the update object
        const updateData = {
          ...personalInfo && { personalInfo }, // Only include personalInfo if it's provided
          ...(name && { name }),
          ...(email && { email }),
          ...(role && { role })
        };

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

    app.patch('/user/:id/experience', async (req, res) => {
      const userId = req.params.id;
      const experienceData = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { experience: experienceData } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send('User not found');
        }

        res.send('Experience data added successfully');
      } catch (err) {
        console.error('Error adding experience data:', err);
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

    app.get('/user/:id/resume', async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      try {
        const resume = await resumesCollection.findOne({ userId: new ObjectId(userId) });

        if (!resume) {
          return res.status(404).send('Resume not found');
        }

        res.download(resume.path, resume.filename);
      } catch (err) {
        console.error('Error retrieving resume:', err);
        res.status(500).send('Internal Server Error');
      }
    });

    app.get('/user/:id/has-resume', async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ hasResume: false, message: "Invalid user ID" });
      }

      try {
        const resume = await resumesCollection.findOne({ userId: new ObjectId(userId) });

        if (resume) {
          return res.send({ hasResume: true });
        } else {
          return res.send({ hasResume: false });
        }
      } catch (error) {
        console.error("Error checking for resume:", error);
        return res.status(500).send({ hasResume: false, message: "Internal server error" });
      }
    });

    app.delete('/user/:id/resume', async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: 'Invalid user ID' });
      }

      try {
        // Find the resume document in the collection
        const resume = await resumesCollection.findOne({ userId: new ObjectId(userId) });

        if (!resume) {
          return res.status(404).send({ message: 'Resume not found' });
        }

        // Delete the resume document from the collection
        const deleteResult = await resumesCollection.deleteOne({ userId: new ObjectId(userId) });

        if (deleteResult.deletedCount === 0) {
          return res.status(500).send({ message: 'Failed to delete resume from database' });
        }

        // Delete the file from the disk
        const filePath = path.join(__dirname, 'uploads', resume.filename);
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Error deleting file:', err);
            return res.status(500).send({ message: 'Failed to delete file from disk' });
          }

          res.send({ message: 'Resume deleted successfully' });
        });

      } catch (error) {
        console.error('Error deleting resume:', error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });




    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne(job);
      res.send(result);
    });

    app.patch('/jobs/apply', async (req, res) => {
      const { userId, jobId } = req.body;

      if (!ObjectId.isValid(userId) || !ObjectId.isValid(jobId)) {
        return res.status(400).send({ message: "Invalid user or job ID" });
      }

      try {
        // Find the job document
        const job = await jobCollection.findOne({ _id: new ObjectId(jobId) });

        if (!job) {
          return res.status(404).send({ message: "Job not found" });
        }

        // Check if the user has already applied
        const hasApplied = job.appliedUsers?.includes(userId);

        if (hasApplied) {
          return res.status(400).send({ message: "You have already applied for this job" });
        }

        // Add the userId to the appliedUsers array
        const updatedJob = await jobCollection.updateOne(
          { _id: new ObjectId(jobId) },
          { $push: { appliedUsers: userId } }
        );

        if (updatedJob.modifiedCount === 1) {
          return res.status(200).send({ message: "Application submitted successfully" });
        } else {
          return res.status(500).send({ message: "Failed to apply for the job" });
        }
      } catch (error) {
        console.error('Error applying for job:', error);
        return res.status(500).send({ message: "Failed to apply for the job" });
      }
    });

    // Import ObjectId if not already imported
    const { ObjectId } = require('mongodb');

    // Increment view count for a specific job
    app.patch('/jobs/incrementView/:id', async (req, res) => {
      const jobId = req.params.id;

      if (!ObjectId.isValid(jobId)) {
        return res.status(400).send({ message: "Invalid job ID" });
      }

      try {
        // Increment the view count by 1
        const result = await jobCollection.updateOne(
          { _id: new ObjectId(jobId) },
          { $inc: { view: 1 } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Job not found or view count not updated" });
        }

        res.status(200).send({ message: "View count incremented successfully" });
      } catch (error) {
        console.error('Error incrementing view count:', error);
        res.status(500).send({ message: "Failed to increment view count" });
      }
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

    app.get('/jobs/appliedJobs/:userId', async (req, res) => {
      const { userId } = req.params;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      try {
        // Find all jobs where the user has applied
        const appliedJobs = await jobCollection.find({ appliedUsers: userId }).toArray();

        if (appliedJobs.length === 0) {
          return res.status(404).send({ message: "No jobs found that the user has applied for" });
        }

        // Return the list of jobs
        return res.status(200).json(appliedJobs);
      } catch (error) {
        console.error('Error retrieving applied jobs:', error);
        return res.status(500).send({ message: "Failed to retrieve applied jobs" });
      }
    });


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
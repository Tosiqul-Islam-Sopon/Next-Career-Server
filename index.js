const express = require("express");
const cors = require("cors");
const multer = require("multer");
const http = require("http");
const { GridFsStorage } = require("multer-gridfs-storage");
const GridFSBucket = require("mongodb").GridFSBucket;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const server = http.createServer(app);

// Set up Socket.IO server with CORS enabled
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust for your environment
    methods: ["GET", "POST"],
  },
});

// Object to store online users mapping (userId -> socketId)
const onlineUsers = {};

// Listen for socket connections
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // When a client registers, store their userId with their socket.id
  socket.on("register", (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    for (const [userId, socketId] of Object.entries(onlineUsers)) {
      if (socketId === socket.id) {
        delete onlineUsers[userId];
        console.log(`User ${userId} disconnected`);
      }
    }
  });
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nnvexxr.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;
// const uri = `mongodb://localhost:27017`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let resumesCollection;
let gfs, resumeBucket, profileImagesBucket, companyLogosBucket;

client
  .connect()
  .then(() => {
    const db = client.db(process.env.DB_NAME);

    // Existing bucket for resumes
    resumeBucket = new GridFSBucket(db, { bucketName: "resumes" });

    // New bucket for user profile images
    profileImagesBucket = new GridFSBucket(db, {
      bucketName: "profile_images",
    });

    // New bucket for company logos
    companyLogosBucket = new GridFSBucket(db, { bucketName: "company_logos" });

    console.log(
      "GridFSBuckets initialized: resumes, profile_images, company_logos"
    );
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
  });

const resumeStorage = new GridFsStorage({
  url: uri,
  file: (req, file) => {
    const userId = req.params.userId;
    return {
      bucketName: "resumes",
      filename: `${Date.now()}-${file.originalname}`, // Naming the file with a timestamp to avoid duplicates
      metadata: { userId: new ObjectId(userId) },
    };
  },
});

const profileImageStorage = new GridFsStorage({
  url: uri,
  file: (req, file) => {
    return {
      bucketName: "profile_images",
      filename: `${Date.now()}-${file.originalname}`,
      metadata: { userId: req.params.userId },
    };
  },
});

const companyLogoStorage = new GridFsStorage({
  url: uri,
  file: (req, file) => {
    return {
      bucketName: "company_logos",
      filename: `${Date.now()}-${file.originalname}`,
      metadata: { userId: req.params.userId },
    };
  },
});

const resumeUpload = multer({ storage: resumeStorage });
const profileImageUpload = multer({ storage: profileImageStorage });
const companyLogoUpload = multer({ storage: companyLogoStorage });

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const database = client.db("Job-Listing");
    // const database = client.db("job-listing");
    const userCollection = database.collection("users");
    const jobCollection = database.collection("jobs");
    const applicationCollection = database.collection("applications");
    const notificationCollection = database.collection("notifications");

    // File upload route
    app.post(
      "/uploadResume/:userId",
      resumeUpload.single("file"),
      (req, res) => {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).send("Invalid user ID");
        }
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        res.status(200).json({ message: "Resume uploaded successfully" });
      }
    );

    // Upload user profile image
    app.post(
      "/uploadProfileImage/:userId",
      profileImageUpload.single("file"),
      (req, res) => {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        res
          .status(200)
          .json({ message: "Profile image uploaded successfully" });
      }
    );

    // Upload company logo
    app.post(
      "/uploadCompanyLogo/:userId",
      companyLogoUpload.single("file"),
      (req, res) => {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        res.status(200).json({ message: "Company logo uploaded successfully" });
      }
    );

    // Serve file download route
    app.get("/allResumes", async (req, res) => {
      try {
        const files = await gfs.find().toArray();
        if (!files || files.length === 0) {
          return res.status(404).json({ message: "No resumes found" });
        }

        const filesData = files.map((file) => ({
          _id: file._id,
          filename: file.filename,
          contentType: file.contentType,
          uploadDate: file.uploadDate,
        }));

        res.status(200).json(filesData);
      } catch (error) {
        console.error("Error fetching resumes:", error);
        res.status(500).json({ message: "Failed to retrieve resumes" });
      }
    });

    app.get("/resume/:userId", async (req, res) => {
      const userId = req.params.userId;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      try {
        // Find the file associated with the userId in the metadata
        const files = await gfs
          .find({ "metadata.userId": new ObjectId(userId) })
          .toArray();

        if (!files || files.length === 0) {
          return res
            .status(404)
            .json({ message: "No file found for this user" });
        }

        // If multiple files exist, pick the most recent (or handle as needed)
        const file = files[0]; // Assuming we fetch the first file (modify as per your logic)

        // Stream the file content back to the client
        const readStream = gfs.openDownloadStreamByName(file.filename);
        readStream.pipe(res);
      } catch (error) {
        console.error("Error retrieving file:", error);
        res.status(500).json({ message: "Error retrieving file" });
      }
    });

    // Fetch user profile image
    app.get("/profileImage/:userId", async (req, res) => {
      try {
        const files = await profileImagesBucket
          .find({ "metadata.userId": req.params.userId })
          .toArray();

        if (!files || files.length === 0) {
          return res.status(404).json({ message: "Profile image not found" });
        }

        const file = files[0];
        res.set("Content-Type", file.contentType); // Set content type dynamically
        const readStream = profileImagesBucket.openDownloadStreamByName(
          file.filename
        );
        readStream.pipe(res);
      } catch (error) {
        console.error("Error retrieving profile image:", error);
        res.status(500).json({ message: "Error retrieving profile image" });
      }
    });

    // Fetch company logo
    app.get("/companyLogo/:userId", async (req, res) => {
      try {
        // Validate companyId
        const userId = req.params.userId;

        if (!userId) {
          return res.status(400).json({ message: "Company ID is required" });
        }

        // If companyId is stored as ObjectId, validate and convert it
        // Uncomment this block if ObjectId is used:
        // if (!ObjectId.isValid(companyId)) {
        //   return res.status(400).json({ message: "Invalid Company ID format" });
        // }

        const files = await companyLogosBucket
          .find({ "metadata.userId": userId }) // Use new ObjectId(companyId) if companyId is stored as ObjectId
          .toArray();

        if (!files || files.length === 0) {
          return res.status(404).json({ message: "Company logo not found" });
        }

        // Serve the most recent file (if multiple exist)
        const file = files.sort((a, b) => b.uploadDate - a.uploadDate)[0];

        // Set Content-Type header and stream the file
        res.set("Content-Type", file.contentType);
        const readStream = companyLogosBucket.openDownloadStreamByName(
          file.filename
        );
        readStream.pipe(res);
      } catch (error) {
        console.error("Error retrieving company logo:", error);
        res.status(500).json({ message: "Error retrieving company logo" });
      }
    });

    app.get("/resume/file/:fileName", async (req, res) => {
      const userId = req.params.userId;
      try {
        const file = await gfs
          .find({ filename: req.params.filename })
          .toArray();
        if (!file || file.length === 0) {
          return res.status(404).json({ message: "File not found" });
        }

        const readStream = gfs.openDownloadStreamByName(req.params.filename);
        readStream.pipe(res);
      } catch (error) {
        console.error("Error retrieving file:", error);
        res.status(500).json({ message: "Error retrieving file" });
      }
    });

    // Delete profile image
    app.delete("/profileImage/:userId", async (req, res) => {
      try {
        const files = await profileImagesBucket
          .find({ "metadata.userId": new ObjectId(req.params.userId) })
          .toArray();

        if (!files || files.length === 0) {
          return res.status(404).json({ message: "Profile image not found" });
        }

        const fileId = files[0]._id;
        await profileImagesBucket.delete(fileId);
        res.status(200).json({ message: "Profile image deleted successfully" });
      } catch (error) {
        console.error("Error deleting profile image:", error);
        res.status(500).json({ message: "Error deleting profile image" });
      }
    });

    // Delete company logo
    app.delete("/companyLogo/:companyId", async (req, res) => {
      try {
        const files = await companyLogosBucket
          .find({ "metadata.companyId": new ObjectId(req.params.companyId) })
          .toArray();

        if (!files || files.length === 0) {
          return res.status(404).json({ message: "Company logo not found" });
        }

        const fileId = files[0]._id;
        await companyLogosBucket.delete(fileId);
        res.status(200).json({ message: "Company logo deleted successfully" });
      } catch (error) {
        console.error("Error deleting company logo:", error);
        res.status(500).json({ message: "Error deleting company logo" });
      }
    });

    // user related api
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

    app.post(
      "/user/:id/resume",
      resumeUpload.single("resume"),
      async (req, res) => {
        const userId = req.params.id;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).send("Invalid user ID");
        }

        if (!req.file) {
          return res.status(400).send("No file uploaded");
        }

        try {
          console.log("Uploaded file:", req.file);
          const resume = {
            userId: new ObjectId(userId),
            filename: req.file.filename,
            uploadDate: new Date(),
          };

          const result = await resumesCollection.insertOne(resume);

          res.send({
            message: "Resume uploaded successfully",
            resumeId: result.insertedId,
          });
        } catch (err) {
          console.error("Error uploading resume:", err);
          res.status(500).send("Internal Server Error");
        }
      }
    );

    app.patch("/user/:id", async (req, res) => {
      const userId = req.params.id;
      const { name, email, role, ...personalInfo } = req.body; // Destructure the data from the request body

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send("Invalid user ID");
      }

      try {
        // Build the update object
        const updateData = {
          ...(personalInfo && { personalInfo }), // Only include personalInfo if it's provided
          ...(name && { name }),
          ...(email && { email }),
          ...(role && { role }),
        };

        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send("User not found");
        }

        res.send("User info updated successfully");
      } catch (err) {
        console.error("Error updating user info:", err);
        res.status(500).send("Internal Server Error");
      }
    });

    app.patch("/recruiter/:id", async (req, res) => {
      const recruiterId = req.params.id;

      // Validate recruiterId
      if (!ObjectId.isValid(recruiterId)) {
        return res.status(400).json({ message: "Invalid recruiter ID" });
      }

      const updates = req.body;

      // Validate that the request body is not empty
      if (!updates || Object.keys(updates).length === 0) {
        return res
          .status(400)
          .json({ message: "No fields provided for update" });
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(recruiterId) }, // Match by ID
          { $set: updates } // Update only the provided fields
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Recruiter not found" });
        }

        res.status(200).json({ message: "Recruiter updated successfully" });
      } catch (error) {
        console.error("Error updating recruiter:", error);
        res.status(500).json({ message: "Error updating recruiter" });
      }
    });

    app.patch("/user/:id/education", async (req, res) => {
      const userId = req.params.id;
      const educationData = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send("Invalid user ID");
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { education: educationData } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send("User not found");
        }

        res.send("Education data added successfully");
      } catch (err) {
        console.error("Error adding education data:", err);
        res.status(500).send("Internal Server Error");
      }
    });

    app.patch("/user/:id/experience", async (req, res) => {
      const userId = req.params.id;
      const experienceData = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send("Invalid user ID");
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { experience: experienceData } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send("User not found");
        }

        res.send("Experience data added successfully");
      } catch (err) {
        console.error("Error adding experience data:", err);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/user/:userId", async (req, res) => {
      const userId = req.params.userId;
      // Check if userId is a valid ObjectId
      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ error: "Invalid user ID format" });
      }

      try {
        const user = await userCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.get("/user-by-email/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send(user);
    });

    app.get("/user/:id/resume", async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send("Invalid user ID");
      }

      try {
        const resume = await resumesCollection.findOne({
          userId: new ObjectId(userId),
        });

        if (!resume) {
          return res.status(404).send("Resume not found");
        }

        res.download(resume.path, resume.filename);
      } catch (err) {
        console.error("Error retrieving resume:", err);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/user/:id/hasResume", async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res
          .status(400)
          .send({ hasResume: false, message: "Invalid user ID" });
      }

      try {
        const resume = await resumesCollection.findOne({
          userId: new ObjectId(userId),
        });

        if (resume) {
          return res.send({ hasResume: true });
        } else {
          return res.send({ hasResume: false });
        }
      } catch (error) {
        console.error("Error checking for resume:", error);
        return res
          .status(500)
          .send({ hasResume: false, message: "Internal server error" });
      }
    });

    app.delete("/user/:id/resume", async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      try {
        // Find the resume document in the collection
        const resume = await resumesCollection.findOne({
          userId: new ObjectId(userId),
        });

        if (!resume) {
          return res.status(404).send({ message: "Resume not found" });
        }

        // Delete the resume document from the collection
        const deleteResult = await resumesCollection.deleteOne({
          userId: new ObjectId(userId),
        });

        if (deleteResult.deletedCount === 0) {
          return res
            .status(500)
            .send({ message: "Failed to delete resume from database" });
        }

        // Delete the file from the disk
        const filePath = path.join(__dirname, "uploads", resume.filename);
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error("Error deleting file:", err);
            return res
              .status(500)
              .send({ message: "Failed to delete file from disk" });
          }

          res.send({ message: "Resume deleted successfully" });
        });
      } catch (error) {
        console.error("Error deleting resume:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/user/userRole/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const adminEmails = process.env.ADMIN_EMAILS?.split(",") || [];

        // ✅ First check if this email is an admin
        if (adminEmails.includes(email)) {
          return res.send("admin");
        }

        // ✅ Otherwise check in DB for user role
        const user = await userCollection.findOne({ email });
        if (user && user.role) {
          return res.send(user.role); // e.g., "user", "recruiter"
        } else {
          return res.status(404).send({ message: "User role not found" });
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne(job);
      res.send(result);
    });

    // Increment view count for a specific job
    app.patch("/jobs/incrementView/:id", async (req, res) => {
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
          return res
            .status(404)
            .send({ message: "Job not found or view count not updated" });
        }

        const updatedJob = await jobCollection.findOne({
          _id: new ObjectId(jobId),
        });

        // Broadcast the updated view count to ALL connected clients
        io.emit("jobViewIncremented", {
          jobId: jobId,
          newViewCount: updatedJob.view,
        });

        res
          .status(200)
          .send({ message: "View count incremented successfully" });
      } catch (error) {
        console.error("Error incrementing view count:", error);
        res.status(500).send({ message: "Failed to increment view count" });
      }
    });

    app.get("/jobs", async (req, res) => {
      try {
        const {
          searchTitle,
          searchCompany,
          category,
          sortCriteria,
          jobType,
          jobLocation,
          page = 1,
          limit = 15,
        } = req.query;

        const filter = {};

        if (searchTitle) {
          filter.jobTitle = { $regex: new RegExp(searchTitle, "i") };
        }
        if (searchCompany) {
          filter["companyInfo.companyName"] = {
            $regex: new RegExp(searchCompany, "i"),
          };
        }
        if (category) {
          filter.jobCategory = category;
        }
        if (jobType) {
          if (jobType === "Full Time" || jobType === "Part Time") {
            query.jobType = jobType;
          } else {
            query.jobLocation = jobType;
          }
        }

        let jobs = await jobCollection
          .find(filter)
          .sort(sortCriteria ? { [sortCriteria]: -1 } : {})
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .toArray();

        const totalJobs = await jobCollection.countDocuments(filter);

        res.status(200).json({
          jobs,
          totalPages: Math.ceil(totalJobs / limit),
          currentPage: parseInt(page),
        });
      } catch (error) {
        console.error("Error fetching jobs:", error);
        res.status(500).json({ message: "Error fetching jobs", error });
      }
    });

    app.get("/jobs/categoriesVacancy", async (req, res) => {
      try {
        const jobs = await jobCollection
          .aggregate([
            {
              $group: {
                _id: "$jobCategory",
                totalVacancy: { $sum: { $toInt: "$vacancy" } }, // Convert vacancy to integer and sum
              },
            },
            {
              $sort: { totalVacancy: -1 }, // Sort by the number of vacancies in descending order
            },
          ])
          .toArray();

        res.status(200).json(jobs);
      } catch (error) {
        console.error("Error fetching jobs:", error);
        res.status(500).json({ message: "Error fetching jobs", error });
      }
    });

    app.get("/jobs/featuredJobs", async (req, res) => {
      const page = parseInt(req.query.page) || 1; // Default to first page
      const limit = parseInt(req.query.limit) || 10; // Default to 10 jobs per page
      const skip = (page - 1) * limit; // Calculate the number of documents to skip

      try {
        // Fetch the total number of jobs
        const totalJobs = await jobCollection.countDocuments();
        const totalPages = Math.ceil(totalJobs / limit); // Calculate total pages

        // Fetch the jobs for the current page
        const topJobs = await jobCollection
          .find({})
          .sort({ view: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        // Send jobs along with pagination information
        res.send({
          jobs: topJobs,
          totalPages,
          currentPage: page,
        });
      } catch (error) {
        console.error("Failed to fetch featured jobs", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/jobs/newestJobs", async (req, res) => {
      const page = parseInt(req.query.page) || 1; // Default to first page
      const limit = parseInt(req.query.limit) || 10; // Default to 10 jobs per page
      const skip = (page - 1) * limit; // Calculate the number of documents to skip

      try {
        // Fetch the total number of jobs
        const totalJobs = await jobCollection.countDocuments();
        const totalPages = Math.ceil(totalJobs / limit); // Calculate total pages

        // Fetch the jobs for the current page sorted by upload date (newest first)
        const newestJobs = await jobCollection
          .find({})
          .sort({ date: -1 }) // Sort by 'date' in descending order
          .skip(skip)
          .limit(limit)
          .toArray();

        // Send jobs along with pagination information
        res.send({
          jobs: newestJobs,
          totalPages,
          currentPage: page,
        });
      } catch (error) {
        console.error("Failed to fetch newest jobs", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/jobs/byIds", async (req, res) => {
      try {
        let { jobIds } = req.query; // Expecting jobIds as a query parameter

        if (!jobIds) {
          return res
            .status(400)
            .json({ message: "jobIds parameter is required" });
        }

        // Convert jobIds into an array if it's a string
        if (typeof jobIds === "string") {
          jobIds = jobIds.split(",");
        }

        // Ensure all jobIds are valid ObjectIds
        const validJobIds = jobIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        if (validJobIds.length === 0) {
          return res.status(400).json({ message: "No valid job IDs provided" });
        }

        // Find jobs with matching jobIds
        const jobs = await jobCollection
          .find({ _id: { $in: validJobIds } })
          .toArray();

        return res.json({ jobs });
      } catch (error) {
        return res
          .status(500)
          .json({ message: "Internal Server Error", error });
      }
    });

    app.get("/jobs/job/:jobId", async (req, res) => {
      const jobId = req.params.jobId;
      const job = await jobCollection.findOne({ _id: new ObjectId(jobId) });
      res.send(job);
    });

    app.get("/jobs/appliedJobs/:userId", async (req, res) => {
      const { userId } = req.params;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      try {
        // Find all jobs where the user has applied
        const appliedJobs = await applicationCollection
          .find({
            appliedUsers: { $elemMatch: { userId } }, // Check if userId exists in any object within the array
          })
          .toArray();

        if (appliedJobs.length === 0) {
          return res
            .status(404)
            .send({ message: "No jobs found that the user has applied for" });
        }

        // Return the list of jobs
        return res.status(200).json(appliedJobs);
      } catch (error) {
        console.error("Error retrieving applied jobs:", error);
        return res
          .status(500)
          .send({ message: "Failed to retrieve applied jobs" });
      }
    });

    app.get("/jobs/category/:category", async (req, res) => {
      const category = req.params.category;

      try {
        const jobs = await jobCollection
          .find({ jobCategory: category })
          .toArray();
        res.send(jobs);
      } catch (error) {
        console.error("Error fetching jobs by category:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/jobs/myPostedJobs/:email", async (req, res) => {
      const email = req.params.email;

      try {
        // Fetch jobs from the jobCollection where the userInfo.email matches the provided email
        const jobs = await jobCollection
          .find({ "userInfo.email": email })
          .toArray();

        // Check if jobs were found
        if (jobs.length === 0) {
          return res
            .status(404)
            .send({ message: "No jobs found for this user." });
        }

        // Send the jobs as the response
        res.status(200).send(jobs);
      } catch (error) {
        // Handle errors and send a 500 status code
        console.error("Error fetching jobs:", error);
        res
          .status(500)
          .send({ message: "Server error. Please try again later." });
      }
    });

    app.get("/jobs/appliedUsers/:id", async (req, res) => {
      try {
        const jobId = req.params.id;

        // Find the job by _id and get appliedUsers
        const job = await jobCollection.findOne({ _id: new ObjectId(jobId) });

        if (!job) {
          return res.status(404).json({ message: "Job not found" });
        }

        // Return the appliedUsers array
        res.json({ appliedUsers: job.appliedUsers });
      } catch (error) {
        console.error("Error retrieving applied users:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.post("/jobs/apply", async (req, res) => {
      const { userId, jobId, jobTitle, applicantName } = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      if (!ObjectId.isValid(jobId)) {
        return res.status(400).send({ message: "Invalid job ID" });
      }

      try {
        const application = await applicationCollection.findOne({ jobId });

        if (application) {
          const updatedApplication = await applicationCollection.updateOne(
            { jobId },
            {
              $push: {
                appliedUsers: {
                  userId,
                  appliedOn: new Date().toISOString(),
                },
              },
            }
          );

          if (updatedApplication.modifiedCount === 1) {
            const job = await jobCollection.findOne({
              _id: new ObjectId(jobId),
            });
            const jobPosterId = job?.postedBy;

            // Build the notification object
            const notification = {
              userId: new ObjectId(jobPosterId), // The recipient of the notification
              type: "jobApplication",
              message: `${applicantName} has been submitted a new application for your job ${jobTitle}`,
              data: { jobId, applicantId: userId },
              isRead: false,
              createdAt: new Date(),
            };

            // Store the notification in the database
            await notificationCollection.insertOne(notification);

            if (jobPosterId && onlineUsers[jobPosterId]) {
              io.to(onlineUsers[jobPosterId]).emit("jobApplication", {
                message: `${applicantName} has been submitted a new application for your job ${jobTitle}`,
                jobId,
                applicantId: userId,
              });
            }

            return res
              .status(200)
              .send({ message: "Application submitted successfully" });
          } else {
            return res
              .status(500)
              .send({ message: "Failed to apply for the job" });
          }
        } else {
          const newApplication = {
            jobId,
            appliedUsers: [
              {
                userId,
                appliedOn: new Date().toISOString(),
              },
            ],
          };

          const result = await applicationCollection.insertOne(newApplication);

          if (result.acknowledged) {
            const job = await jobCollection.findOne({
              _id: new ObjectId(jobId),
            });
            const jobPosterId = job?.postedBy; // Use a consistent field name

            // Build the notification object
            const notification = {
              userId: new ObjectId(jobPosterId), // The recipient of the notification
              type: "jobApplication",
              message: `${applicantName} has been submitted a new application for your job ${jobTitle}`,
              data: { jobId, applicantId: userId },
              isRead: false,
              createdAt: new Date(),
            };

            // Store the notification in the database
            await notificationCollection.insertOne(notification);

            if (jobPosterId && onlineUsers[jobPosterId]) {
              io.to(onlineUsers[jobPosterId]).emit("jobApplication", {
                message: `${applicantName} has been submitted a new application for your job ${jobTitle}`,
                jobId,
                applicantId: userId,
              });
            }

            return res
              .status(200)
              .send({ message: "Application submitted successfully" });
          } else {
            console.error("Error in application insertion");
            return res
              .status(500)
              .send({ message: "Failed to apply for the job" });
          }
        }
      } catch (error) {
        console.error("Error applying for job:", error);
        return res.status(500).send({ message: "Failed to apply for the job" });
      }
    });

    app.get("/jobs/checkApplication", async (req, res) => {
      const { userId, jobId } = req.query; // Use req.query to get query params

      // Validate ObjectId format
      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      if (!ObjectId.isValid(jobId)) {
        return res.status(400).send({ message: "Invalid job ID" });
      }

      try {
        // Check if an application already exists for the specific job and user
        const application = await applicationCollection.findOne({
          jobId,
          "appliedUsers.userId": userId, // Query the specific userId inside the appliedUsers array
        });

        if (application) {
          // User has already applied for this job
          return res.send(true);
        } else {
          // User has not applied for this job
          return res.send(false);
        }
      } catch (error) {
        console.error("Error checking application status:", error);
        return res
          .status(500)
          .send({ message: "Failed to check application status" });
      }
    });

    app.get("/jobs/totalApplicants/:jobId", async (req, res) => {
      try {
        const { jobId } = req.params;

        if (!ObjectId.isValid(jobId)) {
          return res.status(400).json({ message: "Invalid job ID" });
        }

        const applicationObj = await applicationCollection.findOne({ jobId });

        if (!applicationObj) {
          return res.status(404).json({ message: "Job not found" });
        }

        return res.json({
          totalApplicants: applicationObj.appliedUsers.length,
        });
      } catch (error) {
        return res
          .status(500)
          .json({ message: "Internal Server Error", error });
      }
    });

    app.get("/jobs/applicants/:jobId", async (req, res) => {
      const { jobId } = req.params;

      if (!ObjectId.isValid(jobId)) {
        return res.status(400).send({ message: "Invalid job ID" });
      }

      try {
        // Fetch job application and applicants from the 'applications' collection
        const application = await applicationCollection.findOne({ jobId });

        if (!application) {
          return res
            .status(404)
            .send({ message: "No applications found for this job" });
        }

        // Extract user IDs from the appliedUsers array
        const userIds = application.appliedUsers.map(
          (applicant) => new ObjectId(applicant.userId)
        );

        // Fetch full user details from the 'users' collection
        const users = await userCollection
          .find({ _id: { $in: userIds } })
          .toArray();

        // Combine user details with the corresponding application details
        const detailedApplicants = application.appliedUsers.map((applicant) => {
          const user = users.find(
            (u) => u._id.toString() === applicant.userId.toString()
          );
          return {
            ...user, // Spread user details
            appliedOn: applicant.appliedOn, // Add the appliedOn field from the application
          };
        });

        return res.status(200).send(detailedApplicants);
      } catch (error) {
        console.error("Error fetching applicants:", error);
        return res.status(500).send({ message: "Failed to fetch applicants" });
      }
    });

    // PATCH /jobs/advanceStage/:jobId/:userId

    app.patch("/jobs/advanceStage/:jobId/:userId", async (req, res) => {
      try {
        const { jobId, userId } = req.params;
        const { stage } = req.body;

        // 1. Prepare job update query
        const jobUpdate = {
          $addToSet: { completedStages: stage },
        };

        const isHired = stage.toLowerCase() === "hire";

        if (isHired) {
          jobUpdate.$inc = { recruited: 1 };
        }

        // 2. Update job document
        await jobCollection.updateOne({ _id: new ObjectId(jobId) }, jobUpdate);

        // Update application: add stage to progressStages for the given user
        await applicationCollection.updateOne(
          { jobId },
          {
            $addToSet: {
              "appliedUsers.$[user].progressStages": stage,
            },
          },
          {
            arrayFilters: [{ "user.userId": userId }],
          }
        );

        const message = isHired
          ? "🎉 Congratulations! You have been hired for the position."
          : `🎯 You've been selected for the ${stage} stage`;

        const notification = {
          userId: new ObjectId(userId), // 👈 the applicant receiving the notification
          type: "stageProgress",
          message,
          data: { jobId, stage },
          isRead: false,
          createdAt: new Date(),
        };

        await notificationCollection.insertOne(notification);

        if (userId && onlineUsers[userId]) {
          io.to(onlineUsers[userId]).emit("stageProgress", {
            message,
            jobId,
            stage,
          });
        }

        res.status(200).json({ message: "Stage updated successfully" });
      } catch (err) {
        res.status(500).json({ message: "Error updating stage", error: err });
      }
    });

    app.get("/notifications/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        // Fetch unread notifications from the database
        const notifications = await notificationCollection
          .find({ userId: new ObjectId(userId) })
          .sort({ createdAt: -1 }) // Sort by newest first
          .toArray();

        res.status(200).json({ success: true, notifications });
      } catch (error) {
        console.error("Error fetching notifications:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.get("/notifications/unread/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        // Fetch unread notifications from the database
        const notifications = await notificationCollection
          .find({ userId: new ObjectId(userId), isRead: false })
          .sort({ createdAt: -1 }) // Sort by newest first
          .toArray();

        res.status(200).json({ success: true, notifications });
      } catch (error) {
        console.error("Error fetching notifications:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Job is listing..............");
});

server.listen(port, () => {
  console.log(`Job listing on port ${port}`);
});

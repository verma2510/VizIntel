const express = require("express");
const router = express.Router();
const activityController = require("../controllers/activityController");
const auth = require("../middlewares/auth");

router.get("/summary", auth, activityController.getSummary);
router.get("/events", auth, activityController.getEvents);

module.exports = router;

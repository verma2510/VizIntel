const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const auth = require("../middlewares/auth");

router.use(auth);
router.get("/", dashboardController.list);
router.post("/", dashboardController.create);
router.get("/:id", dashboardController.get);
router.put("/:id", dashboardController.update);
router.delete("/:id", dashboardController.remove);
router.post("/:id/duplicate", dashboardController.duplicate);
router.post("/:id/share", dashboardController.share);
router.delete("/:id/share", dashboardController.unshare);

module.exports = router;

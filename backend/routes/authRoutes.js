const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const rateLimit = require("../middlewares/rateLimit");
const auth = require("../middlewares/auth");
const { config } = require("../config/env");

// Per-IP brute-force protection (no-op when Redis is not configured).
const authLimiter = rateLimit({ name: "auth", max: config.rateLimit.authPerMinute, keyFn: (req) => req.ip });

router.post("/register", authLimiter, authController.registerUser);
router.post("/login", authLimiter, authController.loginUser);
router.get("/me", auth, authController.getMe);
router.patch("/me", auth, authController.updateMe);
router.post("/password", [auth, authLimiter], authController.changePassword);

module.exports = router;

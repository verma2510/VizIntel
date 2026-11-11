const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: "User already exists" });

    user = new User({ name, email, password });
    
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    await user.save();

    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: 360000 }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid Credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid Credentials" });

    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: 360000 }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

// --- Profile & credentials (authenticated) --------------------------------------------------------
// Errors propagate to middlewares/errorHandler.js. A wrong current password is a 400, never a 401, so
// the SPA does not interpret it as an expired session and log the user out.
const { z } = require("zod");
const { BadRequestError, NotFoundError } = require("../lib/errors");

const toPublicUser = (user) => ({ id: String(user._id), name: user.name, email: user.email, createdAt: user.createdAt });

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80).optional(),
    email: z.string().trim().email("Enter a valid email address").max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined, { message: "Nothing to update" });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(200),
  newPassword: z.string().min(6, "New password must be at least 6 characters").max(200),
});

exports.getMe = async (req, res) => {
  const user = await User.findById(req.user.id, { name: 1, email: 1, createdAt: 1 }).lean();
  if (!user) throw new NotFoundError("User not found");
  res.json({ user: toPublicUser(user) });
};

exports.updateMe = async (req, res) => {
  const patch = updateProfileSchema.parse(req.body);
  if (patch.email) {
    const taken = await User.exists({ email: patch.email, _id: { $ne: req.user.id } });
    if (taken) throw new BadRequestError("That email address is already in use");
  }
  const user = await User.findByIdAndUpdate(req.user.id, { $set: patch }, { returnDocument: "after", projection: { name: 1, email: 1, createdAt: 1 } }).lean();
  if (!user) throw new NotFoundError("User not found");
  res.json({ user: toPublicUser(user) });
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await User.findById(req.user.id);
  if (!user) throw new NotFoundError("User not found");
  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) throw new BadRequestError("Current password is incorrect");
  user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await user.save();
  res.status(204).end();
};

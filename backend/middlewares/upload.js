const multer = require("multer");
const { config } = require("../config/env");
const { BadRequestError } = require("../lib/errors");

// Use memory storage to process the excel file in memory directly
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  // Memory storage buffers the whole file in RAM, so cap it (previously unbounded => memory exhaustion risk).
  limits: { fileSize: config.upload.maxFileMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || file.mimetype === "application/vnd.ms-excel" || file.mimetype === "text/csv") {
      cb(null, true);
    } else {
      cb(new BadRequestError("Please upload an Excel or CSV file"));
    }
  }
});

module.exports = upload;

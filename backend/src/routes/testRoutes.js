const express = require("express");
const { testDB } = require("../controllers/testController");

const router = express.Router();

router.get("/test-db", testDB);

module.exports = router;

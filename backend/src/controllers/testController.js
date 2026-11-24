const pool = require("../config/db");

const testDB = async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    return res.json({
      message: "Database connected successfully ✅",
      time: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Database connection failed ❌",
    });
  }
};

module.exports = { testDB };

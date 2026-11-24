const classService = require("../services/classService");
const { ClassInUseError } = classService;

const createClass = async (req, res) => {
  try {
    const row = await classService.createClass(req.body);
    return res.status(201).json(row);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create class" });
  }
};

const getClasses = async (req, res) => {
  try {
    const rows = await classService.getClasses();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch classes" });
  }
};

const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await classService.updateClass(id, req.body);

    if (!row) {
      return res.status(404).json({ message: "Class not found" });
    }

    return res.json(row);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update class" });
  }
};

const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await classService.deleteClass(id);
    return res.json(result);
  } catch (error) {
    if (error instanceof ClassInUseError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to delete class" });
  }
};

module.exports = {
  createClass,
  getClasses,
  updateClass,
  deleteClass,
};

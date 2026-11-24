const sectionService = require("../services/sectionService");
const { SectionInUseError, SectionValidationError } = sectionService;

const createSection = async (req, res) => {
  try {
    const row = await sectionService.createSection(req.body);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof SectionValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to create section" });
  }
};

const getSections = async (req, res) => {
  try {
    const { class_id } = req.params;
    const rows = await sectionService.getSections(class_id);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch sections" });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sectionService.deleteSection(id);
    return res.json(result);
  } catch (error) {
    if (error instanceof SectionInUseError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to delete section" });
  }
};

module.exports = {
  createSection,
  getSections,
  deleteSection,
};

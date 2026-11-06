const express = require('express');
const roomsController = require('../controllers/rooms.controller');

const router = express.Router();

router.get('/', roomsController.listRooms);
router.post('/', roomsController.createOrGetRoom);
router.get('/:code', roomsController.getRoomByCode);

module.exports = router;


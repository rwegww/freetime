const express = require('express');
const authRoutes = require('./auth.routes');
const groupsRoutes = require('./groups.routes');
const roomsRoutes = require('./rooms.routes');
const membersRoutes = require('./members.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/groups', groupsRoutes);
router.use('/rooms', roomsRoutes);
router.use('/rooms/:code/members', membersRoutes);

module.exports = router;

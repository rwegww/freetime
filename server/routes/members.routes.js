const express = require('express');
const membersController = require('../controllers/members.controller');

const router = express.Router({ mergeParams: true });

router.get('/', membersController.listMembers);
router.post('/', membersController.upsertMember);

module.exports = router;


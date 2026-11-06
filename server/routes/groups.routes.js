const express = require('express');
const groupsController = require('../controllers/groups.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(requireAuth);

router.get('/', groupsController.listMyGroups);
router.post('/', groupsController.createGroup);
router.post('/join', groupsController.joinGroup);
router.get('/:code', groupsController.getGroupByCode);

module.exports = router;

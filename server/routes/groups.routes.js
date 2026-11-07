const express = require('express');
const groupsController = require('../controllers/groups.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(requireAuth);

router.get('/', groupsController.listMyGroups);
router.post('/', groupsController.createGroup);
router.post('/join', groupsController.joinGroup);
router.get('/preview', groupsController.previewGroupByCode);
router.get('/preview/:code', groupsController.previewGroupByCode);
router.post('/:code/leave', groupsController.leaveGroup);
router.get('/:code', groupsController.getGroupByCode);
router.put('/:code/schedule', groupsController.updateMyGroupSchedule);
router.post('/:code/messages', groupsController.postGroupMessage);
router.post('/:code/messages/:messageId/vote', groupsController.voteGroupProposal);

module.exports = router;

const { handleUpdate } = require('../bot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Flipe DevBot Webhook activo');
  }

  try {
    const update = req.body;
    if (update) {
      await handleUpdate(update);
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook Error]:', err);
    return res.status(500).send('Internal Error');
  }
};

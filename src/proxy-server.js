// 代理服务
// 将此文件部署到支持 CORS 的服务器上，或者本地用 node/python 启动

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// 彩票代理
app.post('/proxy/lottery', async (req, res) => {
  try {
    const response = await axios.post('http://api.yunmge.com/api/lottery', req.body, {
      headers: {
        'Authorization': 'Bearer 6ad41ac5eed70a63382ff767103705b7',
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 壁纸代理
app.get('/proxy/wallpaper', async (req, res) => {
  try {
    const { category } = req.query;
    const response = await axios.get(`https://api.mmp.cc/api/pcwallpaper?category=${category}&type=json`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('代理服务运行在 http://localhost:3000'));

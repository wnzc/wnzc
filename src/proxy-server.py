# Python 代理服务
# 运行方式: python proxy-server.py
# 然后将页面中的接口地址改为 http://localhost:8080/proxy/xxx

from flask import Flask, jsonify, request
import requests

app = Flask(__name__)

@app.route('/proxy/lottery', methods=['POST'])
def proxy_lottery():
    data = request.json
    headers = {
        'Authorization': 'Bearer 6ad41ac5eed70a63382ff767103705b7',
        'Content-Type': 'application/json'
    }
    try:
        response = requests.post('http://api.yunmge.com/api/lottery', json=data, headers=headers)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/proxy/wallpaper', methods=['GET'])
def proxy_wallpaper():
    category = request.args.get('category', '')
    try:
        url = f'https://api.mmp.cc/api/pcwallpaper?category={category}&type=json'
        response = requests.get(url)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=8080, debug=True)

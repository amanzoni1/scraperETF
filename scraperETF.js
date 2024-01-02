const axios = require('axios');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config();
require('events').EventEmitter.defaultMaxListeners = 20;

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

const apiKey = process.env.BINANCE_API_KEY;
const secretKey = process.env.BINANCE_SECRET_KEY;
const pOUser = process.env.PUSH_USER_ID;
const pOToken = process.env.PUSH_TOKEN;

const symbol = 'BTCUSDT';
const size = 1000000;
const fallbackPrice = 45000;
let myOpenPositions = {};
let priceObj = {};
let infoObj = {};
let appOrderTriggered = false; 
let rejOrderTriggered = false;
let reconnectionAttempts = 0;
let isConnected = false;
let ws = null;
let socket;



setPriceObj();
setInfoObj()
setInterval(setInfoObj, 24 * 60 * 60 * 1000);
setInterval(async () => {
  try {
    await getOpenPositions();
  } catch (error) {
    console.error('Error in getMyPosInterval:', error.message);
  }
}, 1000);
reciveNews();






//RECIVE MESSAGE FROM THE SOCKET
async function reciveNews() {
  if (isConnected || ws) {
    console.log("Connection already established or in progress.");
    return;
  }

  console.log('Connecting to WebSocket...');
  isConnected = true;
  ws = new WebSocket('ws://tokyo.treeofalpha.com:5124');

  ws.on('open', () => {
    console.log('Connection with TreeNewsTokyo opened');
    ws.send('login 842752f3f9b8271110aa50829407762f536b8a34e43661db7f3e3ff4cb8ca772');
    reconnectionAttempts = 0;
  });

  ws.on('message', async (data) => { 
    processMessage(data); 
  });

  ws.on('close', (code) => {
    console.log(`WebSocket connection closed with code ${code}`);
    isConnected = false;
    ws = null;
    attemptReconnect();
  });

  ws.on('error', (e) => {
    console.log('WebSocket connection error: ' + e);
  });
}


function attemptReconnect() {
  if (reconnectionAttempts < 20) {
    setTimeout(() => {
      reciveNews();
      reconnectionAttempts++;
    }, Math.pow(2, reconnectionAttempts) * 1000); 
  } else {
    console.log('Max reconnection attempts reached.');
  }
}




async function processMessage(data) {
  try {
    const message = JSON.parse(data);
  
    if (message.source === 'SEC_ETF_SRO') {
      let textToInterpret = message.title;
      let sender = 'tokyoScraper';
      let latestPrice = priceObj.hasOwnProperty('BTCUSDT') && priceObj['BTCUSDT'].price > 0 ? priceObj['BTCUSDT'].price : fallbackPrice;
      let notificationMessage;

      switch (message.analysis) {
        case 'bitcoin_approval':
          if (appOrderTriggered) {
            console.log(sender + ': ' + textToInterpret);
            console.log("Order already triggered");
            return;
          }
          appOrderTriggered = true;
  
          if (myOpenPositions.hasOwnProperty('BTCUSDT') && myOpenPositions['BTCUSDT'].amount > 300000) { 
            console.log(sender + ': ' + textToInterpret);
            console.log("Already have a large position in BTCUSDT, not creating a new order.");
            return;
          } else {
            const quantity = size / latestPrice; 
            await createOrder("BUY", symbol, quantity);
            console.log(sender + ': ' + textToInterpret);
            notificationMessage = `BTC SPOT ETF has been approved and an order created for ${quantity} BTC!`;
            console.log(symbol, quantity, latestPrice);
            sendNotification(pOUser, pOToken, notificationMessage, 1);
            console.log(notificationMessage);
          }
          break;

        case 'bitcoin_rejection':
          if (rejOrderTriggered) {
            console.log(sender + ': ' + textToInterpret);
            console.log("Order already triggered");
            return;
          }
          rejOrderTriggered = true;
  
          if (myOpenPositions.hasOwnProperty('BTCUSDT') && myOpenPositions['BTCUSDT'].amount < 300000) {
            console.log(sender + ': ' + textToInterpret);
            console.log("Already have a large position in BTCUSDT, not creating a new order.");
            return;
          } else {
            const quantity = size / latestPrice; 
            await createOrder("SELL", symbol, quantity);
            console.log(sender + ': ' + textToInterpret);
            notificationMessage = `BTC SPOT ETF has been rejected and an order created for ${quantity} BTC!`;
            console.log(symbol, quantity, latestPrice);
            sendNotification(pOUser, pOToken, notificationMessage, 1);
            console.log(notificationMessage);
          }
          break;

        case 'bitcoin_delay':
          console.log(sender + ': ' + textToInterpret);
          notificationMessage = "BTC SPOT ETF has been delayed";
          sendNotification(pOUser, pOToken, notificationMessage);
          console.log(notificationMessage);
          break;

        case 'bitcoin_unknown':
          console.log(sender + ': ' + textToInterpret);
          notificationMessage = "BTC SPOT ETF has received some unknown news";
          sendNotification(pOUser, pOToken, notificationMessage);
          console.log(notificationMessage);
          break;

        default:
          console.log(sender + ': ' + textToInterpret);
          console.log("Unrecognized analysis type.");
          return;
      }
    } else {
      console.log('Message from unrecognized source ignored.'); 
      return; 
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
}








//Create a new order
async function createOrder(paramsSide, symbol, quantity) {
  const urlOrder = `https://fapi.binance.com/fapi/v1/order`;
  const timestamp = Date.now();
  const formattedQuantity = formatMarketQuantity(quantity, symbol)
  const orderParams = {
    symbol: symbol,
    type: 'MARKET',
    side: paramsSide,
    quantity: formattedQuantity,
    timestamp: timestamp
  }
  const signature = generateSignature(orderParams);
  const config = {
    headers: { 'X-MBX-APIKEY': apiKey },
    params: { ...orderParams, signature },
  };

  try {
    const response = await axios.post(urlOrder, null, config);
    const order = await queryOrders(response.data.symbol, response.data.orderId);

    const timestampSL = Date.now();
    const formattedStPrice = formatPrice( orderParams.side === 'BUY' ? (parseFloat(order.avgPrice * 0.985)) : (parseFloat(order.avgPrice * 1.015)), orderParams.symbol)
    const stopMarketOrderParams = {
      symbol: orderParams.symbol,
      type: 'STOP_MARKET',
      side: orderParams.side === 'BUY' ? 'SELL' : 'BUY',
      quantity: Number(order.executedQty),
      stopPrice: formattedStPrice,
      timestamp: timestampSL
    };
    const signature = generateSignature(stopMarketOrderParams);
    
    try {
      const config = {
        headers: { 'X-MBX-APIKEY': apiKey },
        params: { ...stopMarketOrderParams, signature },
      };

      const responseSL = await axios.post(urlOrder, null, config);
      return response.data;

    } catch (e) {
      console.log(e.constructor.name, e.message, e.response.data);
      return e.message
    }

  } catch (e) {
    console.log(e.constructor.name, e.message, e.response.data);
    return e.message;
  }
}








//Generate signature when needed
function generateSignature(params) {
  try {
    const queryString = Object.keys(params)
      .map((key) => `${key}=${params[key]}`)
      .join('&');
  
    const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
    return signature;
  } catch (e) {
    console.error('Error generating signature:', e);
    return e;
  }
}


// query the status of a specific order
async function queryOrders(symbol, orderId) {
  const timestamp = Date.now();
  const url = `https://fapi.binance.com/fapi/v1/order`;
  const params = { timestamp, symbol, orderId };
  const signature = generateSignature(params);
  const config = {
    headers: { 'X-MBX-APIKEY': apiKey },
    params: { ...params, signature },
  };

  try {
    const response = await axios.get(url, config);
    return response.data;
  } catch (e) {
    console.error(e);
    return e;
  }
}


//Get my open positions
async function getOpenPositions() {
  try {
    const timestamp = Date.now();
    const url = `https://fapi.binance.com/fapi/v2/positionRisk`;
    const params = { timestamp };
    const signature = generateSignature(params);
    const config = {
      headers: { 'X-MBX-APIKEY': apiKey },
      params: { ...params, signature },
    };

    const response = await axios.get(url, config);
    const openPositions = response.data.filter(position => parseFloat(position.notional) !== 0);

    let newOpenPositions = {};

    for (const position of openPositions) {
      const amount = parseFloat(position.markPrice) * parseFloat(position.positionAmt);
      const side = parseFloat(position.positionAmt) > 0 ? 'long' : 'short';
      newOpenPositions[position.symbol] = {
        amount: amount,
        side: side
      };
    }

    myOpenPositions = newOpenPositions;

    return myOpenPositions;
  } catch (e) {
    console.log('Error getting open positions:', e.constructor.name, e.message);
    return e.message; 
  }
}


















// SETTING PARAMETRI E FILTRI


//Keep update real time price of a symbol
function setPriceObj() {
  const streamName = `${symbol.toLowerCase()}@ticker`;

  if (socket) {
      socket.removeAllListeners('message');
      socket.removeAllListeners('close');
      socket.removeAllListeners('error');
      socket.close();  
  }

  socket = new WebSocket(`wss://fstream.binance.com/ws/${streamName}`);
  socket.on('message', (data) => {
      const priceData = JSON.parse(data);
      const price = parseFloat(priceData.c);
      priceObj[symbol] = { price: price };
  });
  socket.on('close', (code) => {
      console.log(`WebSocket connection closed with code ${code}`);
      setTimeout(() => setPriceObj(), 1000);
  });
  socket.on('error', (e) => {
      console.log('WebSocket connection error: ' + e);
      setTimeout(() => setPriceObj(), 1000);
  });
}


//Create an object with the orders filters
async function setInfoObj() {
    try {
      const response = await axios.get(`https://fapi.binance.com/fapi/v1/exchangeInfo`);
      const tradingSymbols = response.data.symbols.filter((e) => e.status === "TRADING");
      tradingSymbols.forEach((symbol) => { infoObj[symbol.symbol] = symbol.filters });
      return infoObj;
    } catch (e) {
      console.error("Error fetching exchange info:", e);
      return e;
    }
  }
  
  
  // set a price in line with filters
  function formatPrice(price, symbol) {
    const symbolFilters = infoObj[symbol];
    const priceFilter = symbolFilters.find((filter) => filter.filterType === "PRICE_FILTER");
  
    if (!priceFilter) {
      console.error("PRICE_FILTER not found for this symbol.");
      return price;
    }
  
    const { minPrice, maxPrice, tickSize } = priceFilter;
    const priceNumber = parseFloat(price);
    const tickSizeNumber = parseFloat(tickSize);
  
    if (tickSizeNumber === 0) { return price; }
  
    const adjustedPrice = Math.round((priceNumber - parseFloat(minPrice)) / tickSizeNumber) * tickSizeNumber + parseFloat(minPrice);
    const formattedPrice = adjustedPrice.toFixed((tickSize.split('.')[1] || []).length);
  
    return formattedPrice;
  }
  
  
  // set a qty in line with filters with markets orders
  function formatMarketQuantity(quantity, symbol) {
    const symbolFilters = infoObj[symbol];
    const marketLotSizeFilter = symbolFilters.find((filter) => filter.filterType === "MARKET_LOT_SIZE");
  
    if (!marketLotSizeFilter) {
      console.error("MARKET_LOT_SIZE filter not found for this symbol.");
      return { formattedQuantity: quantity, ordersRequired: 1 }; 
    }
  
    const { minQty, maxQty, stepSize } = marketLotSizeFilter;
    const quantityNumber = parseFloat(quantity);
    const stepSizeNumber = parseFloat(stepSize);
    const maxQtyNumber = parseFloat(maxQty);
  
    if (stepSizeNumber === 0) { return { formattedQuantity: quantity, ordersRequired: 1 }; }
  
    let ordersRequired = 1;
    let adjustedQuantity;
  
    if (quantityNumber > maxQtyNumber) {
      ordersRequired = Math.ceil(quantityNumber / maxQtyNumber);
      adjustedQuantity = maxQtyNumber;
    } else {
      adjustedQuantity = Math.round((quantityNumber - parseFloat(minQty)) / stepSizeNumber) * stepSizeNumber + parseFloat(minQty);
    }
    const formattedQuantity = adjustedQuantity.toFixed((stepSize.split('.')[1] || []).length);
  
    return formattedQuantity;
  }

  



  

// SEND NOTIFICATION FOR EVERYTHING HAPPEN
async function sendNotification(user, token, message, priority = 0, title = "(Scrapers) ETF RESPONSE!!") {
    const url = 'https://api.pushover.net/1/messages.json';
  
    const params = {
      token: token,
      user: user,
      message: message,
      title: title,
      priority: priority
    };
  
    try {
      const response = await axios.post(url, params);
      console.log('Notification sent successfully', response.data);
    } catch (error) {
      console.error('Error sending notification', error.data);
    }
  }
  




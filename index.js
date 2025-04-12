const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const API_KEY = process.env.HERE_API_KEY;
const API_BASE_URL = "https://transit.hereapi.com/v8";

// Carregar ônibus adicionais do arquivo extraBusDb.json
let extraBusData = [];
try {
  const rawData = fs.readFileSync('extraBusDb.json');
  extraBusData = JSON.parse(rawData);
  console.log('Ônibus adicionais carregados com sucesso.');
} catch (error) {
  console.warn('Erro ao carregar extraBusDb.json:', error.message);
}

// CACHE
const stationCache = new Map();     // Chave: área aproximada (lat/lon arredondados)
const departuresCache = new Map();  // Chave: stationId
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutos em ms

// Utilitário para arredondar coordenadas e criar uma chave de cache
function getCacheKeyFromLocation(lat, lon, radius) {
  const precision = 0.001; // ~111 metros
  const roundedLat = Math.round(lat / precision) * precision;
  const roundedLon = Math.round(lon / precision) * precision;
  return `${roundedLat.toFixed(3)},${roundedLon.toFixed(3)},${radius}`;
}

// Endpoint para buscar estações com cache baseado em localização arredondada
app.get('/api/stations', async (req, res) => {
  try {
    const { latitude, longitude, radius = 1000 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Os parâmetros latitude e longitude são obrigatórios' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const cacheKey = getCacheKeyFromLocation(lat, lon, radius);
    const cached = stationCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return res.json(cached.data);
    }

    const response = await axios.get(`${API_BASE_URL}/stations`, {
      params: {
        in: `${lat},${lon}`,
        radius,
        return: 'transport',
        apiKey: API_KEY
      }
    });

    stationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: response.data
    });

    res.json(response.data);
  } catch (error) {
    console.error('Erro ao buscar estações:', error.message);
    res.status(500).json({
      error: 'Erro ao buscar estações',
      details: error.response ? error.response.data : error.message
    });
  }
});

// Endpoint para buscar partidas com cache e dados adicionais locais
app.get('/api/departures', async (req, res) => {
  try {
    const { stationId } = req.query;

    if (!stationId) {
      return res.status(400).json({ error: 'O parâmetro stationId é obrigatório' });
    }

    const cached = departuresCache.get(stationId);

    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return res.json(cached.data);
    }

    const response = await axios.get(`${API_BASE_URL}/departures`, {
      params: {
        ids: stationId,
        apiKey: API_KEY
      }
    });

    let data = response.data;

    // Mescla ônibus adicionais com os da API
    data.boards.forEach((board, index) => {
      const additionalBoard = extraBusData.boards.find(b => b.place.name === board.place.name);
      if (additionalBoard) {
        data.boards[index].departures.push(...additionalBoard.departures);
      }
    });

    departuresCache.set(stationId, {
      timestamp: Date.now(),
      data: data
    });

    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar partidas:', error.message);
    res.status(500).json({
      error: 'Erro ao buscar partidas',
      details: error.response ? error.response.data : error.message
    });
  }
});

// Endpoint de verificação de saúde do servidor
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor funcionando corretamente' });
});

app.get('/', (req, res) => {
  res.send("OK");
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
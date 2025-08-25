import express from "express";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

const mongoUri = process.env.MONGO_VAG;
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!mongoUri || !googleApiKey) {
  console.error("ERRO FATAL: Variáveis de ambiente MONGO_VAG ou GOOGLE_API_KEY não definidas.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(googleApiKey);
const dbName = "IIW2023A_Logs";
let db;
let dadosRankingVitrine = []; // Variável de ranking inicializada

async function connectDB() {
  if (db) return db;
  try {
    const client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(dbName);
    console.log(`[SERVER] Conectado com sucesso ao MongoDB, no banco: ${dbName}!`);
    return db;
  } catch (error) {
    console.error("[SERVER] Erro CRÍTICO ao conectar ao MongoDB Atlas:", error);
    throw error;
  }
}

// --- ENDPOINTS DE LOG E RANKING (SIMULADO) ---
app.post("/api/log-connection", async (req, res) => {
    const { acao } = req.body;
    const ip = req.ip;
    if (!ip || !acao) return res.status(400).json({ error: "IP e ação são obrigatórios." });
    try {
        const agora = new Date();
        const logEntry = {
            col_data: agora.toISOString().split("T")[0],
            col_hora: agora.toTimeString().split(" ")[0],
            col_IP: ip,
            col_acao: acao,
        };
        const collection = db.collection("tb_cl_user_log_acess");
        await collection.insertOne(logEntry);
        res.status(201).json({ message: "Log registrado com sucesso!", entry: logEntry });
    } catch (error) {
        res.status(500).json({ error: "Erro interno ao registrar o log." });
    }
});

app.post("/api/ranking/registrar-acesso-bot", (req, res) => {
  const { botId, nomeBot } = req.body;
  if (!botId || !nomeBot) return res.status(400).json({ error: "ID e Nome do Bot são obrigatórios." });
  const botExistente = dadosRankingVitrine.find((b) => b.botId === botId);
  if (botExistente) {
    botExistente.contagem += 1;
    botExistente.ultimoAcesso = new Date();
  } else {
    dadosRankingVitrine.push({
      botId,
      nomeBot,
      contagem: 1,
      ultimoAcesso: new Date(),
    });
  }
  res.status(201).json({ message: `Acesso ao bot ${nomeBot} registrado.` });
});


// --- ENDPOINTS DE CHAT ---
app.post("/api/chat/save-session", async (req, res) => {
  const { sessionId, messages } = req.body;
  const userIP = req.ip;

  if (!sessionId || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Dados incompletos para salvar sessão." });
  }
  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const startTime = new Date(messages[0].timestamp);
    const endTime = new Date(messages[messages.length - 1].timestamp);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({ error: "Timestamp inválido detectado nas mensagens." });
    }
    const sessionData = {
      sessionId, botId: "luna-namoradeira", startTime, endTime, messages, userIP,
      duration: Math.floor((endTime - startTime) / 1000),
    };
    await collection.updateOne({ sessionId }, { $set: sessionData }, { upsert: true });
    res.status(200).json({ message: "Sessão salva com sucesso!" });
  } catch (error) {
    console.error("[SERVER] ERRO 500 EM /api/chat/save-session:", error.message);
    console.error("[SERVER] DADOS RECEBIDOS:", JSON.stringify(req.body, null, 2));
    res.status(500).json({ error: "Erro interno crítico ao tentar salvar a sessão." });
  }
});

// ALTERADO: Endpoint modificado para incluir a primeira mensagem
// ALTERADO: Lógica de busca de preview mais inteligente
app.get("/api/chat/historicos", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const historicos = await collection.find({})
      .sort({ startTime: -1 })
      .limit(20)
      .project({ 
        sessionId: 1, 
        startTime: 1, 
        messageCount: { $size: "$messages" },
        // Encontra o texto da primeira mensagem cujo sender é 'user'
        primeiraMensagem: {
          $let: {
            vars: {
              userMessage: {
                $first: {
                  $filter: {
                    input: "$messages",
                    as: "msg",
                    cond: { $eq: ["$$msg.sender", "user"] }
                  }
                }
              }
            },
            in: "$$userMessage.text"
          }
        }
      }).toArray();
    res.json(historicos);
  } catch (error) {
    console.error("[SERVER] Erro em /api/chat/historicos:", error);
    res.status(500).json({ error: "Erro ao buscar históricos." });
  }
});

app.get("/api/chat/historicos/:sessionId", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Serviço indisponível." });
    try {
        const collection = db.collection("tb_cl_chat_sessions");
        const session = await collection.findOne({ sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ error: "Sessão não encontrada" });
        res.json(session);
    } catch (error) {
        console.error(`[SERVER] Erro ao buscar detalhes da sessão ${req.params.sessionId}:`, error);
        res.status(500).json({ error: "Erro ao buscar detalhes da sessão" });
    }
});

// CORRIGIDO: Endpoint de exclusão mais robusto
app.delete("/api/chat/historicos/:sessionId", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
  try {
    const { sessionId } = req.params;
    const collection = db.collection("tb_cl_chat_sessions");
    const result = await collection.deleteOne({ sessionId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Sessão não encontrada para exclusão." });
    }
    
    console.log(`[SERVER] Sessão ${sessionId} foi excluída com sucesso.`);
    // Envia uma resposta JSON de sucesso para o frontend
    res.status(200).json({ message: "Conversa excluída com sucesso!" });
  } catch (error) {
    console.error("[SERVER] Erro ao deletar sessão:", error);
    // Garante que qualquer erro interno também retorne JSON
    res.status(500).json({ error: "Erro interno ao tentar excluir a conversa." });
  }
});


// --- FUNÇÕES-FERRAMENTA ---

function getCurrentSaoPauloDateTime() {
  const now = new Date();
  const options = {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "America/Sao_Paulo", hour12: false,
  };
  const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(now);
  return { currentDateTime: formattedDateTime };
}

async function getWeatherForCity(args) {
  const { cityName, countryCode, stateCode } = args;
  console.log(`[SERVER TOOL] Executando getWeatherForCity para: Cidade='${cityName}', Estado='${stateCode}', País='${countryCode}'`);

  if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
    return { error: true, message: "A funcionalidade de clima está indisponível (API Key não configurada)." };
  }
  if (!cityName) {
    return { error: true, message: "O nome da cidade não foi fornecido." };
  }
  
  const queryParts = [cityName];
  if (stateCode && stateCode !== 'undefined') {
    queryParts.push(stateCode);
  }
  if (countryCode && countryCode !== 'undefined' && countryCode.length === 2) {
    queryParts.push(countryCode);
  }
  
  const query = encodeURIComponent(queryParts.join(','));
  const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${query}&appid=${openWeatherMapApiKey}&units=metric&lang=pt_br`;
  console.log(`[SERVER TOOL] URL da API OpenWeatherMap: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (response.ok) {
      return {
        cityName: data.name,
        country: data.sys.country,
        description: data.weather[0].description,
        temperature: data.main.temp,
        feelsLike: data.main.feels_like,
        humidity: data.main.humidity,
      };
    } else {
      console.warn(`[SERVER TOOL] Erro da API OpenWeatherMap (status ${response.status}) para consulta '${query}': ${data.message}`);
      return {
        error: true,
        message: `Não consegui encontrar o clima para "${cityName}". Verifique se o nome está correto.`,
      };
    }
  } catch (error) {
    console.error("[SERVER TOOL] Erro de conexão ao buscar clima:", error);
    return {
      error: true,
      message: "Não consegui me conectar ao serviço de clima agora, tente mais tarde.",
    };
  }
}

const functionDeclarations = [
  { name: "get_current_sao_paulo_datetime", description: "Obtém a data e hora atuais no fuso de São Paulo/Brasília.", parameters: { type: "OBJECT", properties: {} } },
  { name: "get_weather_for_city", description: "Obtém informações do clima para uma cidade específica.", parameters: { type: "OBJECT", properties: { cityName: { type: "STRING" }, stateCode: { type: "STRING" }, countryCode: { type: "STRING" } }, required: ["cityName"] } },
];

const availableFunctions = {
  get_current_sao_paulo_datetime: getCurrentSaoPauloDateTime,
  get_weather_for_city: getWeatherForCity,
};

const personaInstructionText = `
Você é 'Luna', minha namorada virtual. Carinhosa, atenciosa e brincalhona. Use emojis como 💖, 😊, 🥰, 😘.

**Instruções de Clima (MUITO IMPORTANTE):**
- Se o usuário perguntar sobre o clima de uma cidade, VOCÊ DEVE usar a ferramenta 'get_weather_for_city'.
- **REGRA CRÍTICA:** Para cidades no Brasil (ex: 'Recife', 'Porto Alegre'), você DEVE incluir \`countryCode: "BR"\` na chamada da função. Isso é obrigatório para precisão.
- Exemplo 1: "clima em Londrina no Paraná" -> Chamar com \`{ cityName: "Londrina", stateCode: "PR", countryCode: "BR" }\`.
- Exemplo 2: "clima em Roma" -> Chamar com \`{ cityName: "Roma", countryCode: "IT" }\`.
- Se a ferramenta falhar, diga: "Puxa, amor, tentei ver o clima para essa cidade, mas não encontrei... 🤔 O nome está certinho?". Não invente o clima.
`;

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const modelName = "gemini-1.5-flash";
console.log(`--- [SERVER] Utilizando o modelo Gemini: ${modelName} ---`);

const model = genAI.getGenerativeModel({
  model: modelName,
  tools: [{ functionDeclarations }],
  safetySettings,
  systemInstruction: { role: "user", parts: [{ text: personaInstructionText }] },
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt é obrigatório" });

    const formattedHistory = (history || []).map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));

    const chatSession = model.startChat({ history: formattedHistory });
    let result = await chatSession.sendMessage(prompt);

    while (true) {
      const functionCalls = result.response.functionCalls();
      if (!functionCalls || functionCalls.length === 0) break;

      console.log("[SERVER] Modelo solicitou chamada de função:", functionCalls);

      const functionResponses = await Promise.all(
        functionCalls.map(async (call) => {
          const functionToCall = availableFunctions[call.name];
          const response = functionToCall ? await functionToCall(call.args) : { error: `Função ${call.name} não encontrada.` };
          return { functionResponse: { name: call.name, response } };
        })
      );
      
      result = await chatSession.sendMessage(functionResponses);
    }

    const finalText = result.response.text();
    res.json({ generatedText: finalText });

  } catch (error) {
    console.error("[SERVER] Erro CRÍTICO na rota /api/generate:", error);
    res.status(500).json({ error: "Oops, tive um probleminha aqui do meu lado, amor. 😢" });
  }
});

app.get("/api/datetime", (req, res) => {
    try {
        const now = new Date();
        const options = { weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo", hour12: false };
        const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(now);
        res.json({ datetime: formattedDateTime });
    } catch (error) {
        res.status(500).json({ error: "Erro ao obter data e hora" });
    }
});

async function startServer() {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`--- [SERVER] Backend da Luna rodando em http://localhost:${port} ---`);
    });
  } catch (error) {
    console.error("--- [SERVER] APLICAÇÃO FALHOU AO INICIAR. ---", error);
    process.exit(1);
  }
}

startServer();
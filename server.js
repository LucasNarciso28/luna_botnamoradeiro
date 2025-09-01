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
const openWeatherMapApiKey = process.env.OPENWEATHERMAP_API_KEY; // Adicionado aqui

if (!mongoUri || !googleApiKey) {
  console.error("ERRO FATAL: Variáveis de ambiente MONGO_VAG ou GOOGLE_API_KEY não definidas.");
  process.exit(1);
}
// Avisa se a chave do OpenWeatherMap não estiver configurada
if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
  console.warn("AVISO: Variável de ambiente OPENWEATHERMAP_API_KEY não definida ou placeholder. A função de clima pode não funcionar.");
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
    if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
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

// REMOVIDO a rota /api/chat/save-session explícita para o frontend chamar.
// Agora, o salvamento da sessão será orquestrado *internamente* no backend
// após cada interação bem-sucedida do Gemini na rota /api/generate.

// Endpoint para buscar histórico de uma sessão específica (usado pelo frontend)
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

// Endpoint para listar as sessões (histórico geral)
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

// Endpoint para deletar uma sessão
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
    res.status(200).json({ message: "Conversa excluída com sucesso!" });
  } catch (error) {
    console.error("[SERVER] Erro ao deletar sessão:", error);
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
  if (stateCode && stateCode !== 'undefined') { // Garante que 'undefined' string não seja incluída
    queryParts.push(stateCode);
  }
  if (countryCode && countryCode !== 'undefined' && countryCode.length === 2) { // Garante que 'undefined' string e códigos inválidos não sejam incluídos
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
        message: `Não consegui encontrar o clima para "${cityName}". Verifique se o nome está correto. (Erro: ${data.message})`,
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

const modelName = "gemini-2.5-flash";
console.log(`--- [SERVER] Utilizando o modelo Gemini: ${modelName} ---`);

// MODIFICADO: A instância do modelo é criada aqui, sem histórico inicial
const model = genAI.getGenerativeModel({
  model: modelName,
  tools: [{ functionDeclarations }],
  safetySettings,
  systemInstruction: { role: "user", parts: [{ text: personaInstructionText }] },
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, sessionId } = req.body;
    if (!prompt || !sessionId) {
      return res.status(400).json({ error: "Prompt e sessionId são obrigatórios" });
    }

    const chatCollection = db.collection("tb_cl_chat_sessions");
    
    // --- NOVO: Encontrar ou criar o registro da sessão ---
    let sessionRecord = await chatCollection.findOne({ sessionId: sessionId });

    let chatMessagesForGemini = []; // Histórico que será passado para o Gemini
    let currentSessionMessages = []; // Histórico completo que será salvo no DB

    if (sessionRecord) {
        // Se a sessão existe, carregue suas mensagens
        currentSessionMessages = sessionRecord.messages;
        // Filtrar e formatar apenas as mensagens de 'user' e 'ai' para o Gemini
        chatMessagesForGemini = currentSessionMessages.map((msg) => ({
            role: msg.sender === "user" ? "user" : "model",
            parts: [{ text: msg.text }],
        }));
    } else {
        // Se for uma nova sessão, inicialize um registro vazio no DB
        // Não é estritamente necessário criar aqui, o upsert abaixo já fará isso
        // Mas podemos definir um startTime para a primeira vez.
        console.log(`[SERVER] Nova sessão detectada: ${sessionId}`);
    }

    // Adicionar a mensagem do usuário ao histórico ANTES de enviar para o Gemini e antes de salvar
    // É importante que o Gemini veja a mensagem do usuário como parte do histórico da *sua* vez.
    const userMessageForDB = { sender: "user", text: prompt, timestamp: new Date().toISOString() };
    currentSessionMessages.push(userMessageForDB);
    // Adicione a mensagem do usuário também ao histórico que o Gemini receberá para a *resposta atual*
    chatMessagesForGemini.push({ role: "user", parts: [{ text: prompt }] });


    const chatSession = model.startChat({ history: chatMessagesForGemini }); // Use o histórico formatado
    
    let result = await chatSession.sendMessage(prompt); // AQUI: o 'prompt' é redundante se já está no history.
                                                        // Precisamos ajustar isso.
                                                        // A primeira chamada a sendMessage já deveria conter a mensagem do usuário,
                                                        // mas como já a adicionamos ao history, podemos fazer:
    result = await chatSession.sendMessage({ // Apenas um placeholder, o histórico já guia o Gemini
        parts: [{ text: prompt }] // Isso é o que a gente envia AGORA para o Gemini
    });                                     // O chatSession já tem o histórico anterior

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

    const aiResponseText = result.response.text();

    // Adicionar a mensagem da IA ao histórico que será salvo
    const aiMessageForDB = { sender: "ai", text: aiResponseText, timestamp: new Date().toISOString() };
    currentSessionMessages.push(aiMessageForDB);

    // Salvar/Atualizar a sessão no MongoDB
    const now = new Date();
    const sessionUpdateData = {
      sessionId: sessionId,
      // startTime só é definido na primeira vez (se não houver sessionRecord), caso contrário, mantém o existente.
      startTime: sessionRecord ? sessionRecord.startTime : now.toISOString(), 
      messages: currentSessionMessages,
      lastActivity: now.toISOString(),
      messageCount: currentSessionMessages.length,
    };

    await chatCollection.updateOne(
      { sessionId: sessionId },
      { $set: sessionUpdateData },
      { upsert: true } // Isso criará o documento se ele não existir
    );
    console.log(`[SERVER] Sessão ${sessionId} atualizada/criada no MongoDB. Total de ${currentSessionMessages.length} mensagens.`);


    res.json({ generatedText: aiResponseText });

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
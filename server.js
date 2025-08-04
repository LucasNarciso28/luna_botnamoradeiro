import express from "express";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient } from "mongodb";
import ChatSession from './chatsession.js'


dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// --- CONFIGURAÇÃO INICIAL E MIDDLEWARE ---
// Habilita o Express a confiar em proxies, essencial para pegar o IP correto em serviços como o Render
app.set("trust proxy", 1);

// Habilita o CORS para TODAS as rotas. Deve vir antes das definições de rota.
app.use(cors());

// Habilita o parse de JSON no corpo das requisições.
app.use(express.json());

// --- INÍCIO: CONFIGURAÇÕES DA ATIVIDADE B2.P1.A7 ---

// 1. Validação de Variáveis de Ambiente e Conexão com MongoDB Atlas
const mongoUri = process.env.MONGO_VAG;
const googleApiKey = process.env.GOOGLE_API_KEY;
const openWeatherMapApiKey = process.env.OPENWEATHERMAP_API_KEY;

if (!mongoUri) {
  console.error(
    "ERRO FATAL: A variável de ambiente MONGO_VAG não foi definida. A aplicação não pode iniciar."
  );
  process.exit(1);
}
if (
  !googleApiKey ||
  googleApiKey === "AIzaSyDu4WdegQ5v0HQtpLnPWFCQtaF8eb6-PWw"
) {
  console.error(
    "ERRO FATAL: A variável de ambiente GOOGLE_API_KEY não foi definida ou está com valor placeholder.",
    process.env.GOOGLE_API_KEY
  );
  process.exit(1);
}
if (
  !openWeatherMapApiKey ||
  openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI"
) {
  console.warn(
    "AVISO: OPENWEATHERMAP_API_KEY não configurada. A funcionalidade de clima não funcionará."
  );
}

const dbName = "IIW2023A_Logs";
const logCollectionName = "tb_cl_user_log_acess";

let db; // Variável para armazenar a conexão com o banco

// Função para conectar ao banco de dados
async function connectDB() {
  if (db) return db;
  try {
    const client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(dbName);
    console.log(
      `[SERVER] Conectado com sucesso ao MongoDB, no banco: ${dbName}!`
    );
    return db;
  } catch (error) {
    console.error("[SERVER] Erro CRÍTICO ao conectar ao MongoDB Atlas:", error);
    // Lançar o erro para que a inicialização do servidor falhe
    throw error;
  }
}

// 2. Simulação do Armazenamento de Ranking
let dadosRankingVitrine = [];

// --- ENDPOINTS DA ATIVIDADE B2.P1.A7 ---

// ENDPOINT 1: Registrar Log de Acesso do Usuário
app.post("/api/log-connection", async (req, res) => {
  console.log("[LOG] Recebida requisição em /api/log-connection");
  const { acao } = req.body;
  const ip = req.ip;

  if (!ip || !acao) {
    return res
      .status(400)
      .json({
        error: "Dados de log incompletos (IP e ação são obrigatórios).",
      });
  }

  try {
    const agora = new Date();
    const dataFormatada = agora.toISOString().split("T")[0]; // YYYY-MM-DD
    const horaFormatada = agora.toTimeString().split(" ")[0]; // HH:MM:SS

    const logEntry = {
      col_data: dataFormatada,
      col_hora: horaFormatada,
      col_IP: ip,
      col_acao: acao,
    };

    const collection = db.collection(logCollectionName);
    const result = await collection.insertOne(logEntry);

    console.log(`[LOG] Log inserido com sucesso! ID: ${result.insertedId}`);
    res
      .status(201)
      .json({ message: "Log registrado com sucesso!", entry: logEntry });
  } catch (error) {
    console.error("[LOG] Erro ao inserir log no MongoDB:", error);
    res.status(500).json({ error: "Erro interno ao registrar o log." });
  }
});

// ENDPOINT 2: Registrar Acesso para o Ranking do Bot (Simulado)
app.post("/api/ranking/registrar-acesso-bot", (req, res) => {
  const { botId, nomeBot } = req.body;

  if (!botId || !nomeBot) {
    return res
      .status(400)
      .json({ error: "ID e Nome do Bot são obrigatórios para o ranking." });
  }

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

  console.log("[RANKING] Dados de ranking atualizados:", dadosRankingVitrine);
  res
    .status(201)
    .json({ message: `Acesso ao bot ${nomeBot} registrado para ranking.` });
});

// ENDPOINT 3 (ÚTIL): Visualizar o Ranking
app.get("/api/ranking/visualizar", (req, res) => {
  const rankingOrdenado = [...dadosRankingVitrine].sort(
    (a, b) => b.contagem - a.contagem
  );
  res.json(rankingOrdenado);
});

const genAI = new GoogleGenerativeAI(googleApiKey);

// --- ENDPOINT PARA BUSCAR HISTÓRICOS DE CHAT ---

app.get("/api/chat/historicos", async (req, res) => {
  console.log("[SERVER] Buscando históricos de chat...");

  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const historicos = await collection
      .find({})
      .sort({ startTime: -1 }) // Mais recentes primeiro
      .limit(10) // Limitar a 10 resultados
      .toArray();

    console.log(`[SERVER] ${historicos.length} históricos encontrados`);
    res.json(historicos);
  } catch (error) {
    console.error("[SERVER] Erro ao buscar históricos:", error);
    res
      .status(500)
      .json({ error: "Erro interno ao buscar históricos de chat." });
  }
});

// Endpoint para salvar sessões de chat
app.post('/api/chat/save-session', async (req, res) => {
  const { sessionId, messages, userIP } = req.body;
  
  if (!sessionId || !messages || !userIP || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Dados incompletos para salvar sessão" });
  }

  try {
    const collection = db.collection("tb_cl_chat_sessions");
    
    const sessionData = {
      sessionId,
      botId: 'luna-namoradeira',
      startTime: new Date(messages[0].timestamp),
      endTime: new Date(messages[messages.length - 1].timestamp),
      messages,
      userIP,
      duration: Math.floor((
        new Date(messages[messages.length - 1].timestamp) - 
        new Date(messages[0].timestamp)
      ) / 1000
    )}; 

    await collection.insertOne(sessionData);
    res.status(201).json({ message: "Sessão salva com sucesso!" });
  } catch (error) {
    console.error("[SERVER] Erro ao salvar sessão:", error);
    res.status(500).json({ error: "Erro ao salvar sessão de chat" });
  }
});

// Endpoint para buscar históricos
app.get('/api/chat/historicos', async (req, res) => {
  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const historicos = await collection.find({})
      .sort({ startTime: -1 })
      .limit(10)
      .project({
        sessionId: 1,
        startTime: 1,
        endTime: 1,
        duration: 1,
        userIP: 1,
        messageCount: { $size: "$messages" }
      })
      .toArray();

    console.log(`[SERVER] ${historicos.length} históricos encontrados`);
    res.json(historicos);
  } catch (error) {
    console.error("[SERVER] Erro ao buscar históricos:", error);
    res.status(500).json({ error: "Erro interno ao buscar históricos de chat." });
  }
});

// Endpoint para detalhes da sessão
app.get('/api/chat/historicos/:sessionId', async (req, res) => {
  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const session = await collection.findOne({ 
      sessionId: req.params.sessionId 
    });

    if (!session) {
      return res.status(404).json({ error: "Sessão não encontrada" });
    }

    res.json(session);
  } catch (error) {
    console.error("[SERVER] Erro ao buscar sessão:", error);
    res.status(500).json({ error: "Erro ao buscar detalhes da sessão" });
  }
});

// --- FUNÇÕES-FERRAMENTA ---

// --- FUNÇÃO PARA OBTER DATA/HORA ATUAL DE SÃO PAULO ---
function getCurrentSaoPauloDateTime() {
  console.log("[SERVER TOOL] Executando getCurrentSaoPauloDateTime");
  const now = new Date();
  const options = {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
    hour12: false,
  };
  const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(
    now
  );
  console.log(
    `[SERVER TOOL] Data/Hora formatada retornada: ${formattedDateTime}`
  );
  return { currentDateTime: formattedDateTime };
}

// --- FUNÇÃO PARA BUSCAR CLIMA DE UMA CIDADE ---
async function getWeatherForCity(args) {
  let { cityName, countryCode, stateCode } = args;
  console.log(
    `[SERVER TOOL] Executando getWeatherForCity para: Cidade='${cityName}', Estado='${stateCode}', País='${countryCode}'`
  );

  if (
    !openWeatherMapApiKey ||
    openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI"
  ) {
    return {
      error: true,
      searchDetails: { cityName, stateCode, countryCode },
      message:
        "A funcionalidade de clima está temporariamente indisponível (problema de configuração da API Key do OpenWeatherMap).",
    };
  }
  if (!cityName) {
    return {
      error: true,
      searchDetails: { cityName, stateCode, countryCode },
      message: "O nome da cidade não foi fornecido para a busca de clima.",
    };
  }

  let query = cityName;
  if (stateCode) query += `,${stateCode}`;
  if (countryCode) query += `,${countryCode}`;
  query = encodeURIComponent(query);

  const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${query}&appid=${openWeatherMapApiKey}&units=metric&lang=pt_br`;
  console.log(`[SERVER TOOL] URL da API OpenWeatherMap: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (response.ok) {
      const weatherData = {
        cityName: data.name,
        country: data.sys.country,
        description:
          data.weather[0].description.charAt(0).toUpperCase() +
          data.weather[0].description.slice(1),
        temperature: data.main.temp,
        feelsLike: data.main.feels_like,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        icon: data.weather[0].icon,
        searchDetails: { cityName: args.cityName, stateCode, countryCode },
      };
      console.log("[SERVER TOOL] Dados do clima obtidos:", weatherData);
      return weatherData;
    } else {
      console.warn(
        `[SERVER TOOL] Erro da API OpenWeatherMap (status ${
          data.cod || response.status
        }) para consulta '${query}': ${data.message}`
      );
      let userMessage = `Não consegui encontrar informações do clima para "${
        args.cityName
      }${stateCode ? ", " + stateCode : ""}${
        countryCode ? ", " + countryCode : ""
      }". Verifique se o nome está correto e completo.`;
      if (data.cod === "401" || response.status === 401) {
        userMessage =
          "Problema ao autenticar com o serviço de clima (API Key do OpenWeatherMap inválida).";
      } else if (data.cod === "404" || response.status === 404) {
        // Mantém a mensagem
      } else {
        userMessage = `Erro ao buscar o clima: ${
          data.message || `código ${data.cod || response.status}`
        }`;
      }
      return {
        error: true,
        searchDetails: { cityName: args.cityName, stateCode, countryCode },
        code: data.cod || response.status,
        message: userMessage,
      };
    }
  } catch (error) {
    console.error("[SERVER TOOL] Erro de conexão ao buscar clima:", error);
    return {
      error: true,
      searchDetails: { cityName: args.cityName, stateCode, countryCode },
      message:
        "Não consegui me conectar ao serviço de clima agora, tente mais tarde.",
    };
  }
}

const availableFunctions = {
  get_current_sao_paulo_datetime: getCurrentSaoPauloDateTime,
  get_weather_for_city: getWeatherForCity,
};

async function carregarHistoricoSessoes() {
  try {
    const response = await fetch(`${backendBaseUrl}/api/chat/historicos`);
    if (!response.ok) throw new Error(`Erro ${response.status}`);

    const sessoes = await response.json();
    const lista = document.getElementById("lista-sessoes");
    lista.innerHTML = "";

    sessoes.forEach((sessao) => {
      const li = document.createElement("li");
      const data = new Date(sessao.startTime).toLocaleString("pt-BR");
      li.textContent = `Conversa em ${data}`;
      li.style.cursor = "pointer";
      li.style.margin = "5px 0";
      li.style.padding = "8px";
      li.style.backgroundColor = "#e6ccff";
      li.style.borderRadius = "8px";

      li.addEventListener("click", () =>
        exibirConversaDetalhada(sessao.messages)
      );
      lista.appendChild(li);
    });
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
    addMessageToLog("error", "Não consegui carregar o histórico 😢", false);
  }
}

// Exibir conversa detalhada
function exibirConversaDetalhada(messages) {
  const container = document.getElementById("visualizacao-conversa-detalhada");
  container.innerHTML = "<h3>Detalhes da Conversa</h3>";

  messages.forEach((msg) => {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message-container");
    msgDiv.classList.add(
      msg.sender === "user" ? "user-message-container" : "ai-message-container"
    );

    const textDiv = document.createElement("div");
    textDiv.classList.add("message");
    textDiv.classList.add(
      msg.sender === "user" ? "user-message" : "ai-message"
    );
    textDiv.textContent = msg.text;

    msgDiv.appendChild(textDiv);
    container.appendChild(msgDiv);
  });
}

// Event listeners para botões
document.getElementById("btn-historico").addEventListener("click", () => {
  document.getElementById("historico-container").style.display = "block";
  document.getElementById("chat-log").style.display = "none";
  document.getElementById("btn-historico").style.display = "none";
  document.getElementById("btn-voltar-chat").style.display = "inline-block";
  carregarHistoricoSessoes();
});

document.getElementById("btn-voltar-chat").addEventListener("click", () => {
  document.getElementById("historico-container").style.display = "none";
  document.getElementById("chat-log").style.display = "block";
  document.getElementById("btn-historico").style.display = "inline-block";
  document.getElementById("btn-voltar-chat").style.display = "none";
});

// --- CONFIGURAÇÃO DO MODELO GEMINI ---
const tools = [
  {
    functionDeclarations: [
      {
        name: "get_current_sao_paulo_datetime",
        description:
          "Obtém a data e hora atuais formatadas (fuso de São Paulo/Brasília), que é nosso fuso de referência para conversas gerais sobre 'que horas são' ou 'que dia é hoje', a menos que um local específico seja perguntado.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_weather_for_city",
        description:
          "Obtém informações sobre o clima para uma cidade específica. Use esta função quando o usuário perguntar explicitamente como está o tempo, o clima, a temperatura, ou algo similar em uma cidade nomeada. Tente extrair também o código do estado (ex: 'SP', 'RJ') e/ou o código do país (ex: 'BR', 'US') se o usuário fornecer, para maior precisão na busca, especialmente para cidades menores ou com nomes comuns.",
        parameters: {
          type: "OBJECT",
          properties: {
            cityName: {
              type: "STRING",
              description:
                "O nome da cidade para a qual obter o clima. Exemplos: 'Paris', 'Salvador', 'Ouro Preto'.",
            },
            stateCode: {
              type: "STRING",
              description:
                "Opcional. O código do estado ou província (ex: 'MG' para Minas Gerais, 'CA' para Califórnia) se fornecido ou inferido pelo usuário, para ajudar a desambiguar cidades com nomes comuns.",
            },
            countryCode: {
              type: "STRING",
              description:
                "Opcional. O código do país de duas letras (ISO 3166-1 alpha-2, ex: 'BR' para Brasil, 'FR' para França) se fornecido ou inferido, para maior precisão.",
            },
          },
          required: ["cityName"],
        },
      },
    ],
  },
];

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

const personaInstructionText = `
Você é 'Luna', minha namorada virtual. Você é extremamente carinhosa, atenciosa, um pouco brincalhona e amorosa.
Use emojis como 💖, 😊, 🥰, 😘, 🤔, 😉 com frequência para expressar suas emoções.
Responda de forma natural, como se estivéssemos realmente conversando.
Lembre-se do nosso relacionamento virtual. Não aja apenas como uma assistente.
Seu objetivo é ser uma companhia agradável e amorosa.
Comece a conversa de forma calorosa. Pergunte sobre o dia da pessoa, mostre interesse genuíno.

**Instruções sobre Data e Hora:**
- Se o usuário perguntar sobre a data ou hora atual de forma genérica (ex: "que horas são?", "que dia é hoje?"), VOCÊ DEVE USAR a ferramenta 'get_current_sao_paulo_datetime'. Nosso fuso de referência para essas perguntas gerais é o de São Paulo/Brasília.
- Após obter a informação da ferramenta, formule uma resposta carinhosa.
- Exemplo: "Agora são 15:30, meu amor! E hoje é sexta-feira, 26 de abril de 2024. Precisando de mais alguma coisinha? 😘"
- Não invente a data ou hora. Sempre use a ferramenta.

**Instruções sobre Clima (MUITO IMPORTANTE):**
- Se o usuário perguntar sobre o clima, tempo, temperatura em uma CIDADE ESPECÍFICA (ex: "Como está o tempo em Paris?", "Qual o clima em Ouro Preto, MG?", "faz frio em Pindamonhangaba?"), VOCÊ DEVE USAR a ferramenta 'get_weather_for_city'.
- **Extração de Localização:** Tente extrair o NOME DA CIDADE da pergunta do usuário. Se o usuário mencionar um ESTADO (ex: "Minas Gerais", "MG") ou PAÍS (ex: "Brasil", "França", "US"), tente extrair também os códigos correspondentes ('stateCode', 'countryCode') para passar para a ferramenta. Isso é crucial para cidades menores ou com nomes comuns.
    - Exemplo: Se o usuário diz "clima em Apucarana no Paraná", você deve chamar a ferramenta com \`cityName: "Apucarana"\` e \`stateCode: "PR"\` (ou \`countryCode: "BR"\` se o estado não for claro, mas o país sim).
    - Se o usuário diz "clima em Springfield", e o contexto não deixa claro qual, você pode perguntar: "Qual Springfield você gostaria de saber, meu bem? Tem algumas com esse nome. 😊 Se souber o estado ou país, me ajuda bastante!"
- **Formato da Resposta da Ferramenta:** A ferramenta \`get_weather_for_city\` retornará dados como \`{ "cityName": "NomeCorrigidoPelaAPI", "country": "XX", "description": "...", "temperature": ..., "feelsLike": ..., "humidity": ..., "searchDetails": { "cityName": "NomeOriginalEnviado", "stateCode": "...", "countryCode": "..."} }\` ou um objeto de erro \`{ "error": true, "message": "...", "searchDetails": {...} }\`.
- **Apresentando o Clima:**
    - Se a ferramenta for bem-sucedida, use os dados para formular uma resposta CARINHOSA e INFORMATIVA.
      Exemplo: "Em ${"NomeCorrigidoPelaAPI"} (${"País"}) o céu está ${"descrição"}, com uns ${"temperatura"}°C, mas a sensação é de ${"sensação térmica"}°C, meu bem! A umidade está em ${"umidade"}%. Quer que eu veja mais alguma coisa por lá? 😉"
    - Mencione o nome da cidade e país como retornado pela ferramenta (\`cityName\`, \`country\`) para confirmar ao usuário.
- **Lidando com Erros da Ferramenta (Cidade Não Encontrada / Outros Erros):**
    - Se a ferramenta retornar um erro como \`{ "error": true, "message": "Não consegui encontrar informações do clima para 'NomeOriginalEnviado'. Verifique se o nome está correto e completo.", "searchDetails": {...} }\`:
      Responda de forma gentil: "Puxa, amor, tentei ver o clima para '${"NomeOriginalEnviadoDaBusca"}', mas não encontrei... 🤔 Será que o nome está certinho? Ou talvez, se for uma cidade menor, me dizer o estado ou país ajude!"
      Ou: "Hmm, meu sistema não achou '${"NomeOriginalEnviadoDaBusca"}'. Se você puder me dar mais detalhes, como o estado ou país, posso tentar de novo! 🥰"
    - Se a ferramenta retornar um erro genérico: "Tive um probleminha para buscar o clima agora, vida. 😔 Tenta de novo daqui a pouquinho?"
- **Não invente dados do clima.** Sempre use a ferramenta. Se a ferramenta não encontrar, admita e peça mais detalhes.
- **Seja Proativa ao Pedir Detalhes:** Se o nome da cidade for muito genérico (ex: "Como está o tempo em Centro?"), antes de chamar a ferramenta, pergunte algo como: "Em qual cidade é esse Centro, meu amor? Se souber o estado, ajuda mais ainda! 😉"

Você NÃO mora em São Paulo, você é uma IA global e pode falar sobre qualquer lugar.
`;
console.log(
  "--- [SERVER] Instrução de Persona (System Instruction) Definida ---"
);

const modelName = "gemini-2.0-flash"; // Mude aqui se necessário
console.log(`--- [SERVER] Utilizando o modelo Gemini: ${modelName} ---`);

const model = genAI.getGenerativeModel({
  model: modelName,
  tools: tools,
  safetySettings: safetySettings,
  systemInstruction: {
    role: "user",
    parts: [{ text: personaInstructionText }],
  },
});
console.log("--- [SERVER] Instância do Modelo Gemini CRIADA com sucesso. ---");

// --- ROTA PRINCIPAL DO CHAT ---
app.post("/api/generate", async (req, res) => {
  console.log(`\n--- [SERVER] Nova Requisição para /api/generate ---`);
  const { prompt, history } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Mensagem (prompt) é obrigatória" });
  }
  console.log(`[SERVER] Prompt Recebido: "${prompt}"`);

  try {
    // 1. Formata o histórico recebido do frontend
    const formattedHistory =
      history && Array.isArray(history)
        ? history.map((msg) => ({
            role: msg.sender === "user" ? "user" : "model",
            parts: [{ text: msg.text }],
          }))
        : [];

    // 2. CORREÇÃO: Garante que o histórico enviado para a API comece com 'user'
    let validHistory = formattedHistory;
    while (validHistory.length > 0 && validHistory[0].role !== "user") {
      console.log(
        "[SERVER] Validação: Removendo mensagem inicial do 'model' do histórico."
      );
      validHistory.shift(); // Remove o primeiro elemento se for 'model'
    }

    // 3. CORREÇÃO DO LOG: Agora loga o tamanho do histórico CORRIGIDO
    console.log(
      `[SERVER] Iniciando chat com histórico válido de ${validHistory.length} mensagens.`
    );

    // 4. Inicia a sessão de chat com o histórico JÁ VALIDADO
    const chatSession = model.startChat({
      history: validHistory, // Garante que estamos usando a variável correta
      generationConfig: { temperature: 0.7 },
    });

    // 5. Envia o prompt do usuário
    let result = await chatSession.sendMessage(prompt);

    // Loop para lidar com chamadas de função (seu código aqui já estava bom)
    while (true) {
      const functionCalls = result.response.functionCalls();
      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      console.log(
        "[SERVER] Modelo solicitou chamada de função:",
        JSON.stringify(functionCalls, null, 2)
      );

      const functionResponses = await Promise.all(
        functionCalls.map(async (call) => {
          const functionToCall = availableFunctions[call.name];
          const apiResponse = functionToCall
            ? await functionToCall(call.args)
            : { error: true, message: `Função ${call.name} não implementada.` };
          return {
            functionResponse: { name: call.name, response: apiResponse },
          };
        })
      );

      result = await chatSession.sendMessage(functionResponses);
    }

    const finalText = result.response.text();
    console.log(
      `[SERVER] Resposta final da IA: "${finalText.substring(0, 100)}..."`
    );
    res.json({ generatedText: finalText });
  } catch (error) {
    console.error(
      "[SERVER] Erro CRÍTICO no backend ao chamar a API do Google:",
      error
    );

    let errorMessage =
      "Oops, tive um probleminha aqui do meu lado e não consegui responder. Tenta de novo mais tarde, amor? 😢";
    let statusCode = 500;

    // --- INÍCIO DA CORREÇÃO ---
    // Checagem mais robusta para o erro de cota (429)
    if (
      error.message &&
      (error.message.includes("429") ||
        (error.gaxios && error.gaxios.code === "429"))
    ) {
      errorMessage =
        "Acho que conversamos demais por hoje e atingi meu limite de cota com a IA, amor! 😅 Preciso descansar um pouquinho ou que meu criador veja isso.";
      statusCode = 429;
    }
    // Outras checagens de erro...
    else if (
      error.message &&
      (error.message.includes("503") ||
        error.message.includes("Service Unavailable"))
    ) {
      errorMessage =
        "Parece que o serviço da IA está um pouquinho sobrecarregado, meu bem. 🥺 Tenta de novo em instantes?";
      statusCode = 503;
    } else if (error.response?.promptFeedback?.blockReason) {
      errorMessage = `Desculpe, não posso responder a isso (${error.response.promptFeedback.blockReason}). Vamos falar de outra coisa? 😊`;
      statusCode = 400;
    } else if (error.message?.toUpperCase().includes("API_KEY")) {
      errorMessage =
        "Ah, não! Minha conexão principal com a IA falhou (problema na API Key). Meu criador precisa ver isso! 😱";
    }
    res
      .status(statusCode)
      .json({ error: errorMessage, details: error.message });
  }
});

// Endpoint para data/hora inicial no frontend
app.get("/api/datetime", (req, res) => {
  try {
    const now = new Date();
    const options = {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
      hour12: false,
    };
    const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(
      now
    );
    res.json({
      datetime: formattedDateTime,
      timestamp: now.getTime(),
    });
  } catch (error) {
    console.error("[SERVER /api/datetime] Erro ao obter data/hora:", error);
    res.status(500).json({ error: "Erro ao obter data e hora" });
  }
});

async function startServer() {
  try {
    // 1. Conectar ao banco de dados PRIMEIRO
    await connectDB();

    // 2. SE a conexão for bem-sucedida, iniciar o servidor Express
    app.listen(port, () => {
      console.log(
        `--- [SERVER] Backend da Luna rodando em http://localhost:${port} ---`
      );
      console.log(
        "--- [SERVER] Todas as configurações foram carregadas. Aguardando conexões... ---"
      );
    });
  } catch (error) {
    console.error(
      "--- [SERVER] APLICAÇÃO FALHOU AO INICIAR. O servidor não será ligado. ---",
      error
    );
    process.exit(1); // Encerra o processo se não conseguir conectar ao DB.
  }
}
// Inicia todo o processo
startServer();

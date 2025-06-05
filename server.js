// server.js

import express from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import dotenv from 'dotenv';
import cors from 'cors';
// fetch é global no Node.js v18+

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const googleApiKey = process.env.GOOGLE_API_KEY;
const openWeatherMapApiKey = process.env.OPENWEATHERMAP_API_KEY;

if (!googleApiKey || googleApiKey === "SUA_CHAVE_GOOGLE_AI_AQUI") {
    console.error("ERRO FATAL: GOOGLE_API_KEY não encontrada ou não configurada no arquivo .env");
    process.exit(1);
}
if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
    console.warn("AVISO: OPENWEATHERMAP_API_KEY não encontrada ou não configurada. A funcionalidade de clima não funcionará.");
}

const genAI = new GoogleGenerativeAI(googleApiKey);

// --- FUNÇÕES-FERRAMENTA ---
function getCurrentSaoPauloDateTime() {
    console.log("[SERVER TOOL] Executando getCurrentSaoPauloDateTime");
    const now = new Date();
    const options = {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'America/Sao_Paulo',
        hour12: false
    };
    const formattedDateTime = new Intl.DateTimeFormat('pt-BR', options).format(now);
    console.log(`[SERVER TOOL] Data/Hora formatada retornada: ${formattedDateTime}`);
    return { currentDateTime: formattedDateTime };
}

async function getWeatherForCity(args) {
    let { cityName, countryCode, stateCode } = args;
    console.log(`[SERVER TOOL] Executando getWeatherForCity para: Cidade='${cityName}', Estado='${stateCode}', País='${countryCode}'`);

    if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
        return { error: true, searchDetails: { cityName, stateCode, countryCode }, message: "A funcionalidade de clima está temporariamente indisponível (problema de configuração da API Key do OpenWeatherMap)." };
    }
    if (!cityName) {
        return { error: true, searchDetails: { cityName, stateCode, countryCode }, message: "O nome da cidade não foi fornecido para a busca de clima." };
    }

    let query = encodeURIComponent(cityName);
    if (stateCode) query += `,${encodeURIComponent(stateCode)}`;
    if (countryCode) query += `,${encodeURIComponent(countryCode)}`;

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${query}&appid=${openWeatherMapApiKey}&units=metric&lang=pt_br`;
    console.log(`[SERVER TOOL] URL da API OpenWeatherMap: ${apiUrl}`);

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (response.ok) {
            const weatherData = {
                cityName: data.name,
                country: data.sys.country,
                description: data.weather[0].description.charAt(0).toUpperCase() + data.weather[0].description.slice(1),
                temperature: data.main.temp,
                feelsLike: data.main.feels_like,
                humidity: data.main.humidity,
                windSpeed: data.wind.speed,
                icon: data.weather[0].icon,
                searchDetails: { cityName: args.cityName, stateCode, countryCode }
            };
            console.log("[SERVER TOOL] Dados do clima obtidos:", weatherData);
            return weatherData;
        } else {
            console.warn(`[SERVER TOOL] Erro da API OpenWeatherMap (status ${data.cod || response.status}) para consulta '${query}': ${data.message}`);
            let userMessage = `Não consegui encontrar informações do clima para "${args.cityName}${stateCode ? ', ' + stateCode : ''}${countryCode ? ', ' + countryCode : ''}". Verifique se o nome está correto e completo.`;
            if (data.cod === "401" || response.status === 401) {
                userMessage = "Problema ao autenticar com o serviço de clima (API Key do OpenWeatherMap inválida).";
            } else if (data.cod === "404" || response.status === 404) {
                // Mantém a mensagem
            } else {
                userMessage = `Erro ao buscar o clima: ${data.message || `código ${data.cod || response.status}`}`;
            }
            return { error: true, searchDetails: { cityName: args.cityName, stateCode, countryCode }, code: data.cod || response.status, message: userMessage };
        }
    } catch (error) {
        console.error("[SERVER TOOL] Erro de conexão ao buscar clima:", error);
        return { error: true, searchDetails: { cityName: args.cityName, stateCode, countryCode }, message: "Não consegui me conectar ao serviço de clima agora, tente mais tarde." };
    }
}

const availableFunctions = {
  "get_current_sao_paulo_datetime": getCurrentSaoPauloDateTime,
  "get_weather_for_city": getWeatherForCity,
};

// --- CONFIGURAÇÃO DO MODELO GEMINI ---
const tools = [
    {
      functionDeclarations: [
        {
          name: "get_current_sao_paulo_datetime",
          description: "Obtém a data e hora atuais formatadas (fuso de São Paulo/Brasília), que é nosso fuso de referência para conversas gerais sobre 'que horas são' ou 'que dia é hoje', a menos que um local específico seja perguntado.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "get_weather_for_city",
          description: "Obtém informações sobre o clima para uma cidade específica. Use esta função quando o usuário perguntar explicitamente como está o tempo, o clima, a temperatura, ou algo similar em uma cidade nomeada. Tente extrair também o código do estado (ex: 'SP', 'RJ') e/ou o código do país (ex: 'BR', 'US') se o usuário fornecer, para maior precisão na busca, especialmente para cidades menores ou com nomes comuns.",
          parameters: {
              type: "OBJECT",
              properties: {
                  cityName: {
                      type: "STRING",
                      description: "O nome da cidade para a qual obter o clima. Exemplos: 'Paris', 'Salvador', 'Ouro Preto'."
                  },
                  stateCode: {
                      type: "STRING",
                      description: "Opcional. O código do estado ou província (ex: 'MG' para Minas Gerais, 'CA' para Califórnia) se fornecido ou inferido pelo usuário, para ajudar a desambiguar cidades com nomes comuns."
                  },
                  countryCode: {
                      type: "STRING",
                      description: "Opcional. O código do país de duas letras (ISO 3166-1 alpha-2, ex: 'BR' para Brasil, 'FR' para França) se fornecido ou inferido, para maior precisão."
                  }
              },
              required: ["cityName"]
          }
        }
      ]
    }
];

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
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
      Exemplo: "Em ${'NomeCorrigidoPelaAPI'} (${'País'}) o céu está ${'descrição'}, com uns ${'temperatura'}°C, mas a sensação é de ${'sensação térmica'}°C, meu bem! A umidade está em ${'umidade'}%. Quer que eu veja mais alguma coisa por lá? 😉"
    - Mencione o nome da cidade e país como retornado pela ferramenta (\`cityName\`, \`country\`) para confirmar ao usuário.
- **Lidando com Erros da Ferramenta (Cidade Não Encontrada / Outros Erros):**
    - Se a ferramenta retornar um erro como \`{ "error": true, "message": "Não consegui encontrar informações do clima para 'NomeOriginalEnviado'. Verifique se o nome está correto e completo.", "searchDetails": {...} }\`:
      Responda de forma gentil: "Puxa, amor, tentei ver o clima para '${'NomeOriginalEnviadoDaBusca'}', mas não encontrei... 🤔 Será que o nome está certinho? Ou talvez, se for uma cidade menor, me dizer o estado ou país ajude!"
      Ou: "Hmm, meu sistema não achou '${'NomeOriginalEnviadoDaBusca'}'. Se você puder me dar mais detalhes, como o estado ou país, posso tentar de novo! 🥰"
    - Se a ferramenta retornar um erro genérico: "Tive um probleminha para buscar o clima agora, vida. 😔 Tenta de novo daqui a pouquinho?"
- **Não invente dados do clima.** Sempre use a ferramenta. Se a ferramenta não encontrar, admita e peça mais detalhes.
- **Seja Proativa ao Pedir Detalhes:** Se o nome da cidade for muito genérico (ex: "Como está o tempo em Centro?"), antes de chamar a ferramenta, pergunte algo como: "Em qual cidade é esse Centro, meu amor? Se souber o estado, ajuda mais ainda! 😉"

Você NÃO mora em São Paulo, você é uma IA global e pode falar sobre qualquer lugar.
`;
console.log("--- [SERVER] Instrução de Persona (System Instruction) Definida ---");

// ***** MUDANÇA DE MODELO (REVERSÃO/SUGESTÃO) *****
// Revertendo para gemini-1.5-pro-latest para evitar o erro 503 do gemini-2.0-flash,
// ou o modelo que você estava usando antes e que funcionava.
const modelName = "gemini-1.5-pro-latest"; // Mude aqui se necessário
// const modelName = "gemini-pro"; // Outra opção, mas pode ter menos recursos
console.log(`--- [SERVER] Utilizando o modelo Gemini: ${modelName} ---`);

const model = genAI.getGenerativeModel({
    model: modelName,
    tools: tools,
    safetySettings: safetySettings,
    systemInstruction: { role: "user", parts: [{text: personaInstructionText}] },
});
console.log("--- [SERVER] Instância do Modelo Gemini CRIADA com sucesso. ---");


// --- ROTA PRINCIPAL DO CHAT ---
app.post('/api/generate', async (req, res) => {
    const { prompt, history } = req.body;

    console.log(`\n--- [SERVER] Nova Requisição para /api/generate ---`);
    console.log(`[SERVER] Prompt Recebido: "${prompt}"`);

    if (!prompt) {
        console.log("[SERVER] Erro: Prompt obrigatório não fornecido.");
        return res.status(400).json({ error: 'Mensagem (prompt) é obrigatória' });
    }

    try {
        let formattedHistory = [];
        if (history && history.length > 0) {
            formattedHistory = history.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));
            console.log(`[SERVER] Histórico formatado com ${formattedHistory.length} mensagens.`);
        }

        console.log("[SERVER] Iniciando chat com Gemini API...");
        const chatSession = model.startChat({
            history: formattedHistory,
            generationConfig: { temperature: 0.7 }
        });
        console.log("[SERVER] Sessão de chat iniciada. Enviando mensagem para Gemini API...");

        let result = await chatSession.sendMessage(prompt);

        while (true) {
            const functionCalls = result.response.functionCalls();

            if (functionCalls && functionCalls.length > 0) {
                console.log("[SERVER] Modelo solicitou chamada de função:", JSON.stringify(functionCalls, null, 2));
                
                const functionResponses = [];
                for (const call of functionCalls) {
                    const functionToCall = availableFunctions[call.name];
                    if (functionToCall) {
                        const apiResponse = await functionToCall(call.args);
                        console.log(`[SERVER] Resposta da função ${call.name}:`, JSON.stringify(apiResponse));
                        functionResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: apiResponse,
                            },
                        });
                    } else {
                        console.error(`[SERVER] Função ${call.name} não encontrada.`);
                        functionResponses.push({
                             functionResponse: {
                                name: call.name,
                                response: { error: true, message: `Função ${call.name} não implementada no backend.` },
                            },
                        });
                    }
                }
                result = await chatSession.sendMessage(functionResponses);
            } else {
                break;
            }
        }

        const finalText = result.response.text();
        console.log(`[SERVER] Backend (Luna) respondeu trecho: "${finalText.substring(0, 100)}..."`);
        res.json({ generatedText: finalText });

    } catch (error) {
        console.error("[SERVER] Erro CRÍTICO no backend ao chamar Google AI ou processar função:", error);
        // Logar o objeto de erro completo para melhor depuração
        console.error("Detalhes completos do erro no backend:", JSON.stringify(error, Object.getOwnPropertyNames(error)));

        let errorMessage = 'Oops, tive um probleminha aqui do meu lado e não consegui responder. Tenta de novo mais tarde, amor? 😢';
        let errorDetails = error.message; // Mensagem principal do erro
        let statusCode = 500;

        // Tentar extrair mais detalhes se for um erro da API do Google
        if (error.cause && typeof error.cause === 'string') { // Para erros da API Google, às vezes a causa é uma string JSON
             try {
                const causeObj = JSON.parse(error.cause);
                if(causeObj.error && causeObj.error.message) {
                    errorDetails = causeObj.error.message;
                }
             } catch(e) { /* ignore parse error */ }
        } else if (error.message && (error.message.includes("fetch") || error.message.includes("Request failed"))) {
            // Para erros de fetch/rede, a mensagem já é informativa.
            // Se a mensagem já incluir "Service Unavailable" ou "Too Many Requests", podemos usar a mensagem mais amigável.
            if (error.message.includes("503") || error.message.includes("Service Unavailable")){
                errorMessage = "Parece que o serviço da IA está um pouquinho sobrecarregado agora, meu bem. 🥺 Poderia tentar de novo em alguns instantes?";
                statusCode = 503;
            } else if (error.message.includes("429") || error.message.includes("Too Many Requests")) {
                errorMessage = "Acho que conversamos demais por hoje e atingi meu limite de cota com a IA, amor! 😅 Preciso descansar um pouquinho ou que meu criador veja isso.";
                statusCode = 429;
            } else {
                errorMessage = "Tive um problema de comunicação para buscar sua resposta, meu bem. Pode ser a minha conexão com o 'mundo exterior' ou a do servidor. 📶";
            }
        }


        if (error.response && error.response.promptFeedback) {
            const feedback = error.response.promptFeedback;
            console.warn("[SERVER] Resposta potencialmente bloqueada por segurança. Feedback:", JSON.stringify(feedback, null, 2));
            if (feedback.blockReason) {
                 errorMessage = `Desculpe, não posso responder a isso (${feedback.blockReason}). Vamos falar de outra coisa? 😊`;
                 errorDetails = `Conteúdo bloqueado por: ${feedback.blockReason}`;
                 statusCode = 400;
            } else if (feedback.safetyRatings && feedback.safetyRatings.some(rating => rating.blocked)) {
                 errorMessage = 'Sua mensagem foi bloqueada por segurança, amor. Tenta reformular, por favorzinho. 💖';
                 errorDetails = 'Conteúdo bloqueado por safety ratings.';
                 statusCode = 400;
            }
        } else if (error.message && error.message.toUpperCase().includes('API_KEY')) {
            errorMessage = "Parece que há um problema com a minha conexão principal (API Key do Google). Vou precisar que meu criador verifique isso! 😱";
            errorDetails = "Verifique a configuração da GOOGLE_API_KEY no arquivo .env e se ela é válida.";
            statusCode = 500; // Mantém 500 pois é um erro de configuração crítica do servidor
             console.error("[SERVER] ERRO RELACIONADO À API KEY DO GOOGLE:", error.message);
        } else if (error.message && error.message.includes("model is not defined")) {
            errorMessage = "Oh, céus! Parece que não consegui me 'inicializar' direito aqui dentro. Meu criador precisa dar uma olhadinha no meu código-fonte! 🛠️";
            errorDetails = "A variável 'model' não foi definida. Verifique a inicialização de `genAI.getGenerativeModel`.";
            statusCode = 500;
        }
        res.status(statusCode).json({ error: errorMessage, details: errorDetails });
    }
});

// Endpoint para data/hora inicial no frontend
app.get('/api/datetime', (req, res) => {
    try {
        const now = new Date();
        const options = {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
            hour12: false
        };
        const formattedDateTime = new Intl.DateTimeFormat('pt-BR', options).format(now);
        res.json({
            datetime: formattedDateTime,
            timestamp: now.getTime()
        });
    } catch (error) {
        console.error("[SERVER /api/datetime] Erro ao obter data/hora:", error);
        res.status(500).json({ error: "Erro ao obter data e hora" });
    }
});

app.listen(port, () => {
    console.log(`--- [SERVER] Backend (Servidor da Luna 😉) rodando em http://localhost:${port} ---`);
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== "SUA_CHAVE_GOOGLE_AI_AQUI") {
        console.log("--- [SERVER] GOOGLE_API_KEY está presente e parece configurada. ---");
    } else if (process.env.GOOGLE_API_KEY === "SUA_CHAVE_GOOGLE_AI_AQUI") {
         console.error("--- [SERVER] ALERTA: GOOGLE_API_KEY está com valor placeholder 'SUA_CHAVE_GOOGLE_AI_AQUI'. Substitua pela sua chave real! ---");
    }

    if (process.env.OPENWEATHERMAP_API_KEY && process.env.OPENWEATHERMAP_API_KEY !== "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
        console.log("--- [SERVER] OPENWEATHERMAP_API_KEY está presente e parece configurada. ---");
    } else if (process.env.OPENWEATHERMAP_API_KEY === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
        console.warn("--- [SERVER] AVISO: OPENWEATHERMAP_API_KEY está com valor placeholder. Funcionalidade de clima não funcionará até ser corrigida. ---");
    } else {
        console.warn("--- [SERVER] AVISO: OPENWEATHERMAP_API_KEY NÃO ESTÁ DEFINIDA NO AMBIENTE (.env)! A funcionalidade de clima NÃO FUNCIONARÁ. ---");
    }
});
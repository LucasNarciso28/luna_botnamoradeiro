# Luna - Backend do Chatbot

Este é o backend do projeto Luna, um chatbot inteligente e personalizável construído com Node.js, Express e MongoDB. A aplicação permite que os usuários tenham conversas naturais com uma IA, com suporte a personalização de personalidade, histórico de conversas e um painel administrativo.

## 🚀 Funcionalidades

- **Chat em tempo real**: Integração com a API do Google Gemini para respostas inteligentes e contextuais.
- **Sistema de autenticação**: Registro e login de usuários com JWT.
- **Personalização por usuário**: Cada usuário pode definir uma personalidade única para o bot, que sobrescreve a configuração global.
- **Painel administrativo**: Endpoints protegidos para visualização de estatísticas e gerenciamento da personalidade global do bot.
- **Histórico de conversas**: Armazenamento e recuperação de conversas por sessão.
- **Ferramentas de IA integradas**: 
  - Obtenção de data e hora atual (fuso de São Paulo)
  - Consulta de clima para cidades específicas via OpenWeatherMap
- **Logs e métricas**: Registro de acessos e sistema de ranking simulado.

## 🛠️ Tecnologias

- **Node.js** e **Express** para o servidor
- **MongoDB Atlas** com o driver nativo para banco de dados
- **Google Gemini API** para o modelo de linguagem
- **JWT** para autenticação
- **CORS** e **dotenv** para segurança e configuração

## 📋 Pré-requisitos

- Node.js (versão 18 ou superior)
- Conta no MongoDB Atlas (ou MongoDB local)
- Chave de API do Google Gemini
- Chave de API do OpenWeatherMap (opcional, para funcionalidade de clima)

## 🔧 Configuração

1. Clone o repositório:
   ```bash
   git clone <url-do-repositorio>
   cd luna-backend

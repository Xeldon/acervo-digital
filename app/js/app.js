// Acervo Digital · Livraria do Senado — protótipo
// App de página única: lê data/catalogo.json (gerado pelo coletor) e navega por hash (#/, #/obra/slug, #/estante, #/sobre).

const LOTE = 30;                       // quantos cartões desenhar por vez na grade
const MAX_RECENTES = 30;
const CHAVES = { favoritos: 'acervo:favoritos', recentes: 'acervo:recentes' };
const TIPOS = {
  pdf: { selo: 'PDF', acao: 'Ler PDF', icone: 'i-ler' },
  epub: { selo: 'EPUB', acao: 'Baixar EPUB', icone: 'i-baixar' },
  pagina: { selo: 'Online', acao: 'Abrir na Biblioteca Digital', icone: 'i-externo' },
};

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const ordenarTexto = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }).compare;

const estado = {
  catalogo: null,
  obras: [],
  porSlug: new Map(),
  porId: new Map(),
  nomesCategorias: new Map(),
  filtro: { busca: '', categoria: 'todas', formato: 'todos', ordem: 'titulo' },
  resultado: [],
  exibidos: 0,
  telaAtual: null,
  rolagemAcervo: 0,
  navegouNoApp: false,
  pedidoInstalacao: null,
};

// ---------------------------------------------------------------- armazenamento local (estante)

const memoria = {
  ler(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* modo privado ou cota cheia */ }
  },
};
const favoritos = new Set(memoria.ler(CHAVES.favoritos, []));
let recentes = memoria.ler(CHAVES.recentes, []); // [{ id, em, tipo }]

function alternarFavorito(id) {
  if (favoritos.has(id)) favoritos.delete(id); else favoritos.add(id);
  memoria.gravar(CHAVES.favoritos, [...favoritos]);
  return favoritos.has(id);
}

function registrarLeitura(id, tipo) {
  recentes = [{ id, em: Date.now(), tipo }, ...recentes.filter(r => r.id !== id)].slice(0, MAX_RECENTES);
  memoria.gravar(CHAVES.recentes, recentes);
}

// ---------------------------------------------------------------- utilidades

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function adiar(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function tempoRelativo(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'ontem' : `há ${d} dias`;
  return new Date(ms).toLocaleDateString('pt-BR');
}

function formatarPreco(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

let temporizadorAviso;
function avisar(mensagem, duracao = 2600) {
  const aviso = $('#aviso');
  aviso.textContent = mensagem;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, duracao);
}

function icone(id) {
  return `<svg class="icone" aria-hidden="true"><use href="#${id}"/></svg>`;
}

// ---------------------------------------------------------------- preparação dos dados

// Alguns produtos da loja usam o nome do atributo em maiúsculas ("ANO", "EDIÇÃO").
const NOMES_ATRIBUTOS = { ANO: 'Ano', 'EDIÇÃO': 'Edição', EDICAO: 'Edição', PAGINAS: 'Páginas', 'PÁGINA': 'Páginas' };

function prepararObra(obra) {
  const atributos = {};
  for (const [nome, valor] of Object.entries(obra.atributos || {})) {
    const nomeFinal = NOMES_ATRIBUTOS[nome] || nome;
    if (!(nomeFinal in atributos)) atributos[nomeFinal] = valor;
  }
  obra.atributos = atributos;
  const chaveAutor = Object.keys(atributos).find(k => /^(autor|autores|autoria|organiza)/i.test(k));
  const anoNumero = parseInt(String(atributos.Ano || '').match(/\d{4}/)?.[0], 10);
  obra.autor = chaveAutor ? atributos[chaveAutor] : '';
  obra.chaveAutor = chaveAutor;
  obra.ano = Number.isFinite(anoNumero) ? anoNumero : null;
  obra.formatos = new Set(obra.arquivos.map(a => a.tipo));
  obra.tituloNorm = normalizar(obra.titulo);
  obra.autorNorm = normalizar(obra.autor);
  obra.indice = normalizar([
    obra.titulo, obra.autor, obra.resumo, obra.descricao, obra.ano,
    ...Object.values(atributos),
    ...(obra.assuntos || []),
    ...obra.categorias.map(c => estado.nomesCategorias.get(c)),
  ].join(' '));
  return obra;
}

function carregarCatalogo(catalogo) {
  estado.catalogo = catalogo;
  for (const c of catalogo.categorias) estado.nomesCategorias.set(c.slug, c.nome);
  estado.obras = catalogo.obras.map(prepararObra);
  for (const o of estado.obras) { estado.porSlug.set(o.slug, o); estado.porId.set(o.id, o); }
}

// ---------------------------------------------------------------- componentes

function htmlCapa(obra, { grande = false } = {}) {
  const src = obra.capaMini || obra.capa;
  let img = '';
  if (src && grande) {
    // Capa da página da obra: aparece logo, e o navegador escolhe miniatura (280 px) ou original (1000 px).
    const srcset = obra.capaMini && obra.capa ? `${escapar(obra.capaMini)} 280w, ${escapar(obra.capa)} 1000w` : '';
    img = `<img src="${escapar(src)}" ${srcset ? `srcset="${srcset}" sizes="(min-width: 640px) 220px, 120px"` : ''} alt="" decoding="async">`;
  } else if (src) {
    img = `<img src="${escapar(src)}" alt="" loading="lazy" decoding="async">`;
  }
  return `<div class="capa">
    <div class="capa__falsa" aria-hidden="true"><span>${escapar(obra.titulo)}</span></div>
    ${img}
  </div>`;
}

function htmlSelos(obra) {
  return ['pdf', 'epub', 'pagina']
    .filter(t => obra.formatos.has(t))
    .map(t => `<span class="selo selo--${t}">${TIPOS[t].selo}</span>`)
    .join('');
}

function htmlCartao(obra) {
  return `<a class="cartao" href="#/obra/${encodeURIComponent(obra.slug)}">
    ${htmlCapa(obra)}
    <h3 class="cartao__titulo">${escapar(obra.titulo)}</h3>
    ${obra.autor ? `<p class="cartao__autor">${escapar(obra.autor)}</p>` : ''}
    <p class="cartao__meta">${htmlSelos(obra)}${obra.ano ? `<span>${obra.ano}</span>` : ''}</p>
  </a>`;
}

function htmlVitrine(titulo, obras, extra = '') {
  if (!obras.length) return '';
  return `<section class="vitrine">
    <h2 class="vitrine__titulo"><span>${escapar(titulo)}</span>${extra}</h2>
    <div class="fileira">${obras.map(htmlCartao).join('')}</div>
  </section>`;
}

// ---------------------------------------------------------------- tela: acervo

function montarAcervo() {
  const chips = [`<button class="chip" type="button" data-categoria="todas" aria-pressed="true">Todas <small>${estado.obras.length}</small></button>`];
  for (const c of estado.catalogo.categorias) {
    // Categorias genéricas que cobrem quase tudo não ajudam a filtrar.
    if (c.total >= estado.obras.length * 0.8) continue;
    chips.push(`<button class="chip" type="button" data-categoria="${escapar(c.slug)}" aria-pressed="false">${escapar(c.nome)} <small>${c.total}</small></button>`);
  }
  $('#chips-categorias').innerHTML = chips.join('');

  $('#chips-categorias').addEventListener('click', e => {
    const chip = e.target.closest('[data-categoria]');
    if (chip) definirFiltro({ categoria: chip.dataset.categoria });
  });

  const campo = $('#campo-busca');
  const buscar = adiar(() => definirFiltro({ busca: campo.value }), 140);
  campo.addEventListener('input', () => { $('#limpar-busca').hidden = !campo.value; buscar(); });
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') campo.blur(); });
  $('#limpar-busca').addEventListener('click', () => {
    campo.value = ''; $('#limpar-busca').hidden = true; definirFiltro({ busca: '' }); campo.focus();
  });
  $('#botao-mais').addEventListener('click', desenharMais);
  $('#filtro-formato').addEventListener('change', e => definirFiltro({ formato: e.target.value }));
  $('#filtro-ordem').addEventListener('change', e => definirFiltro({ ordem: e.target.value }));
  $('#limpar-filtros').addEventListener('click', () => {
    campo.value = ''; $('#limpar-busca').hidden = true;
    definirFiltro({ busca: '', categoria: 'todas', formato: 'todos' });
  });

  observadorSentinela = new IntersectionObserver(entradas => {
    if (entradas.some(e => e.isIntersecting)) desenharMais();
  }, { rootMargin: '800px 0px' });

  aplicarFiltros();
}

// Observa o fim da grade. Observar de novo força uma nova checagem: se o fim ainda estiver
// visível depois de desenhar um lote (tela alta), o próximo lote é desenhado também.
let observadorSentinela;
function vigiarSentinela() {
  const sentinela = $('#sentinela');
  const restantes = estado.resultado.length - estado.exibidos;
  sentinela.hidden = restantes <= 0;
  $('#botao-mais').textContent = `Mostrar mais obras (${restantes} restantes)`;
  if (!observadorSentinela) return;
  observadorSentinela.unobserve(sentinela);
  if (restantes > 0) observadorSentinela.observe(sentinela);
}

function definirFiltro(mudancas) {
  Object.assign(estado.filtro, mudancas);
  aplicarFiltros();
  if ('categoria' in mudancas || 'formato' in mudancas || 'ordem' in mudancas) {
    const topoGrade = $('#chips-categorias').getBoundingClientRect().top + window.scrollY - 140;
    if (window.scrollY > topoGrade) window.scrollTo({ top: Math.max(0, topoGrade) });
  }
}

const comparadores = {
  titulo: (a, b) => ordenarTexto(a.titulo, b.titulo),
  recentes: (a, b) => (b.ano ?? 0) - (a.ano ?? 0) || ordenarTexto(a.titulo, b.titulo),
  antigos: (a, b) => (a.ano ?? 9999) - (b.ano ?? 9999) || ordenarTexto(a.titulo, b.titulo),
};

function pontuar(obra, termos, frase) {
  let pontos = obra.tituloNorm.includes(frase) ? 50 : 0;
  if (obra.tituloNorm.startsWith(frase)) pontos += 20;
  for (const t of termos) {
    if (obra.tituloNorm.includes(t)) pontos += 10;
    else if (obra.autorNorm.includes(t)) pontos += 6;
    else pontos += 1;
  }
  return pontos;
}

function aplicarFiltros() {
  const { busca, categoria, formato, ordem } = estado.filtro;
  const frase = normalizar(busca).trim();
  const termos = frase.split(/\s+/).filter(Boolean);

  let lista = estado.obras.filter(o =>
    (categoria === 'todas' || o.categorias.includes(categoria)) &&
    (formato === 'todos' || o.formatos.has(formato)) &&
    termos.every(t => o.indice.includes(t)));

  const comparar = comparadores[ordem] || comparadores.titulo;
  if (termos.length) {
    lista = lista
      .map(o => [pontuar(o, termos, frase), o])
      .sort((a, b) => b[0] - a[0] || comparar(a[1], b[1]))
      .map(par => par[1]);
  } else {
    lista.sort(comparar);
  }

  estado.resultado = lista;
  estado.exibidos = 0;
  $('#grade-obras').innerHTML = '';
  desenharMais();

  const filtrando = termos.length > 0 || categoria !== 'todas' || formato !== 'todos';
  $('#contagem').textContent = filtrando
    ? `${lista.length} ${lista.length === 1 ? 'obra encontrada' : 'obras encontradas'}`
    : `${lista.length} obras gratuitas`;
  $('#vazio').hidden = lista.length > 0;
  $('#vitrines').hidden = filtrando;
  for (const chip of document.querySelectorAll('[data-categoria]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.categoria === categoria));
  }
  $('#filtro-formato').value = formato;
  $('#filtro-ordem').value = ordem;
}

function desenharMais() {
  const { resultado, exibidos } = estado;
  if (exibidos >= resultado.length) { vigiarSentinela(); return; }
  const proximo = resultado.slice(exibidos, exibidos + LOTE);
  $('#grade-obras').insertAdjacentHTML('beforeend', proximo.map(htmlCartao).join(''));
  estado.exibidos += proximo.length;
  vigiarSentinela();
}

function desenharVitrines() {
  const partes = [];
  const lidos = recentes.map(r => estado.porId.get(r.id)).filter(Boolean).slice(0, 12);
  partes.push(htmlVitrine('Abertos recentemente', lidos, '<a href="#/estante">Ver estante</a>'));

  partes.push(htmlVitrine('Destaques', estado.obras.filter(o => o.destaque)));

  // "Lançamentos" vem da própria curadoria da loja; sem ela, usa as obras dos anos mais recentes.
  let lancamentos = estado.obras.filter(o => o.lancamento).sort(comparadores.recentes);
  if (!lancamentos.length) {
    const anoMaisRecente = Math.max(...estado.obras.map(o => o.ano ?? 0));
    lancamentos = estado.obras.filter(o => o.ano && o.ano >= anoMaisRecente - 1).sort(comparadores.recentes).slice(0, 15);
  }
  partes.push(htmlVitrine('Lançamentos', lancamentos));

  $('#vitrines').innerHTML = partes.join('');
}

// ---------------------------------------------------------------- tela: obra

function rotuloArquivo(arquivo, repetido) {
  const base = TIPOS[arquivo.tipo]?.acao || 'Abrir arquivo';
  if (!repetido) return base;
  const generico = /^(baixar|acessar|ler)\b/i.test(arquivo.rotulo || '');
  if (arquivo.rotulo && !generico) return `${base}: ${arquivo.rotulo}`;
  const nome = decodeURIComponent(arquivo.url.split('?')[0].split('/').pop() || '');
  return `${base}: ${nome}`;
}

function obrasRelacionadas(obra) {
  const minhas = new Set(obra.categorias);
  return estado.obras
    .filter(o => o !== obra && o.categorias.some(c => minhas.has(c)))
    .map(o => [o.categorias.filter(c => minhas.has(c)).length, Math.abs((o.ano ?? 0) - (obra.ano ?? 0)), o])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, 12)
    .map(x => x[2]);
}

function desenharObra(slug) {
  const tela = $('#tela-obra');
  const obra = estado.porSlug.get(slug);
  if (!obra) {
    tela.innerHTML = `<div class="secao vazio"><p><strong>Obra não encontrada.</strong></p>
      <p>Ela pode ter sido removida do acervo.</p><a class="botao" href="#/">Voltar ao acervo</a></div>`;
    return;
  }
  document.title = `${obra.titulo} · Acervo Digital`;

  const contagemTipos = {};
  for (const a of obra.arquivos) contagemTipos[a.tipo] = (contagemTipos[a.tipo] || 0) + 1;
  const ordemTipos = ['pdf', 'epub', 'pagina'];
  const arquivos = [...obra.arquivos].sort((a, b) => ordemTipos.indexOf(a.tipo) - ordemTipos.indexOf(b.tipo));
  const botoesArquivos = arquivos.map((a, i) => `
    <a class="botao ${i === 0 ? 'botao--primario' : ''}" href="${escapar(a.url)}" target="_blank" rel="noopener"
       data-abrir="${obra.id}" data-tipo="${a.tipo}">
      ${icone(TIPOS[a.tipo]?.icone || 'i-externo')}<span>${escapar(rotuloArquivo(a, contagemTipos[a.tipo] > 1))}</span>
    </a>`).join('');

  const salvo = favoritos.has(obra.id);
  const ficha = Object.entries(obra.atributos)
    .filter(([k]) => k !== obra.chaveAutor)
    .map(([k, v]) => `<dt>${escapar(k)}</dt><dd>${escapar(v)}</dd>`).join('');

  const textoDescricao = obra.descricao || obra.resumo;
  const paragrafos = textoDescricao.split(/\n+/).filter(Boolean).map(p => `<p>${escapar(p)}</p>`).join('');
  const longa = textoDescricao.length > 700;

  const categorias = obra.categorias
    .map(c => `<a href="#/categoria/${encodeURIComponent(c)}">${escapar(estado.nomesCategorias.get(c) || c)}</a>`).join('');
  const assuntos = (obra.assuntos || [])
    .map(a => `<button class="chip" type="button" data-assunto="${escapar(a)}">${escapar(a)}</button>`).join('');
  const relacionadas = obrasRelacionadas(obra);

  tela.innerHTML = `<article class="obra">
    <button class="botao botao--discreto voltar" type="button" data-voltar>${icone('i-voltar')}<span>Voltar</span></button>
    <div class="obra__topo">
      <button class="capa-botao" type="button" data-ampliar aria-label="Ampliar capa" style="all:unset;display:block;cursor:zoom-in">${htmlCapa(obra, { grande: true })}</button>
      <div>
        ${categorias ? `<p class="obra__categorias">${categorias}</p>` : ''}
        <h1>${escapar(obra.titulo)}</h1>
        ${obra.autor ? `<p class="obra__autor">${escapar(obra.autor)}</p>` : ''}
        ${ficha ? `<dl class="ficha">${ficha}</dl>` : ''}
      </div>
    </div>

    <div class="obra__acoes">
      ${botoesArquivos}
      <div class="obra__acoes-sec">
        <button class="botao" type="button" data-favorito="${obra.id}" aria-pressed="${salvo}">
          ${icone(salvo ? 'i-marcador-cheio' : 'i-marcador')}<span>${salvo ? 'Salvo' : 'Salvar'}</span>
        </button>
        <button class="botao" type="button" data-compartilhar>${icone('i-compartilhar')}<span>Compartilhar</span></button>
      </div>
    </div>
    <p class="obra__nota">O arquivo abre em outra aba, direto da Biblioteca Digital do Senado Federal. Antes, o site faz
      uma verificação de segurança automática de alguns segundos. Se o navegador não tiver leitor de PDF, o arquivo
      é baixado: abra-o pelo aviso de download e depois feche a aba da verificação.</p>

    ${paragrafos ? `<section class="obra__descricao ${longa ? 'recolhida' : ''}" id="descricao">
      <h2>Sobre a obra</h2>${paragrafos}
    </section>
    ${longa ? `<button class="botao botao--discreto" type="button" data-expandir>Ler mais</button>` : ''}` : ''}

    ${assuntos ? `<section class="obra__assuntos"><h2>Assuntos</h2><div class="chips">${assuntos}</div></section>` : ''}

    <div class="obra__impresso">
      <p>${obra.impresso
        ? `Também à venda em versão impressa por <strong>${formatarPreco(obra.impresso.preco)}</strong>.`
        : 'Página da obra na Livraria do Senado.'}</p>
      <a class="botao" href="${escapar(obra.url)}" target="_blank" rel="noopener">
        ${icone(obra.impresso ? 'i-carrinho' : 'i-externo')}<span>${obra.impresso ? 'Comprar impresso' : 'Ver na Livraria'}</span>
      </a>
    </div>

    ${relacionadas.length ? `<section class="obra__relacionadas">
      <h2>Obras relacionadas</h2>
      <div class="fileira">${relacionadas.map(htmlCartao).join('')}</div>
    </section>` : ''}
  </article>`;
}

function aoClicarNaObra(e) {
  const alvo = e.target;
  const abrir = alvo.closest('[data-abrir]');
  if (abrir) {
    registrarLeitura(Number(abrir.dataset.abrir), abrir.dataset.tipo);
    // A nova aba passa primeiro pela verificação de segurança da BDSF; o aviso evita a impressão de que travou.
    const mensagens = {
      pdf: 'Abrindo o PDF em outra aba. Aguarde a verificação de segurança do site do Senado (alguns segundos).',
      epub: 'Baixando o EPUB em outra aba. Aguarde a verificação de segurança do site do Senado.',
      pagina: 'Abrindo a Biblioteca Digital do Senado em outra aba.',
    };
    avisar(mensagens[abrir.dataset.tipo] || mensagens.pagina, 6000);
    return;
  }

  if (alvo.closest('[data-voltar]')) {
    if (estado.navegouNoApp) history.back(); else location.hash = '#/';
    return;
  }

  const fav = alvo.closest('[data-favorito]');
  if (fav) {
    const salvo = alternarFavorito(Number(fav.dataset.favorito));
    fav.setAttribute('aria-pressed', String(salvo));
    fav.innerHTML = `${icone(salvo ? 'i-marcador-cheio' : 'i-marcador')}<span>${salvo ? 'Salvo' : 'Salvar'}</span>`;
    avisar(salvo ? 'Obra salva na sua estante.' : 'Obra removida da estante.');
    return;
  }

  if (alvo.closest('[data-compartilhar]')) { compartilhar(); return; }

  const assunto = alvo.closest('[data-assunto]');
  if (assunto) {
    // Busca pelo assunto no acervo inteiro.
    $('#campo-busca').value = assunto.dataset.assunto;
    $('#limpar-busca').hidden = false;
    estado.filtro = { ...estado.filtro, busca: assunto.dataset.assunto, categoria: 'todas', formato: 'todos' };
    estado.rolagemAcervo = 0;
    location.hash = '#/';
    aplicarFiltros();
    return;
  }

  const expandir = alvo.closest('[data-expandir]');
  if (expandir) { $('#descricao').classList.remove('recolhida'); expandir.remove(); return; }

  if (alvo.closest('[data-ampliar]')) {
    const img = $('#tela-obra .capa img');
    if (!img) return;
    const camada = document.createElement('div');
    camada.className = 'ampliacao';
    camada.innerHTML = `<img src="${escapar(img.src)}" alt="Capa ampliada">`;
    camada.addEventListener('click', () => camada.remove());
    document.body.append(camada);
  }
}

async function compartilhar() {
  const slug = decodeURIComponent(location.hash.split('/').slice(2).join('/'));
  const obra = estado.porSlug.get(slug);
  if (!obra) return;
  const pdf = obra.arquivos.find(a => a.tipo === 'pdf') || obra.arquivos[0];
  const dados = { title: obra.titulo, text: `${obra.titulo} — grátis na Livraria do Senado`, url: pdf?.url || obra.url };
  try {
    if (navigator.share) { await navigator.share(dados); return; }
    await navigator.clipboard.writeText(`${dados.text}: ${dados.url}`);
    avisar('Link copiado.');
  } catch (erro) {
    if (erro?.name !== 'AbortError') avisar('Não foi possível compartilhar.');
  }
}

// ---------------------------------------------------------------- tela: estante

function desenharEstante() {
  const salvos = [...favoritos].map(id => estado.porId.get(id)).filter(Boolean).sort(comparadores.titulo);
  const lidos = recentes.filter(r => estado.porId.has(r.id));

  const blocoSalvos = salvos.length
    ? `<div class="grade">${salvos.map(htmlCartao).join('')}</div>`
    : `<p class="estante-vazia">Toque em <strong>Salvar</strong> na página de uma obra para guardá-la aqui.</p>`;

  const blocoRecentes = lidos.length
    ? `<ul class="lista-recentes">${lidos.map(r => {
        const o = estado.porId.get(r.id);
        return `<li><a class="recente" href="#/obra/${encodeURIComponent(o.slug)}">
          ${htmlCapa(o)}
          <span><strong>${escapar(o.titulo)}</strong><small>${TIPOS[r.tipo]?.selo || ''} · aberto ${tempoRelativo(r.em)}</small></span>
          ${icone('i-voltar')}
        </a></li>`;
      }).join('')}</ul>`
    : `<p class="estante-vazia">As obras que você abrir vão aparecer aqui.</p>`;

  $('#estante-conteudo').innerHTML = `
    <section class="estante-bloco">
      <h2>Salvos <small class="contagem">${salvos.length}</small></h2>${blocoSalvos}
    </section>
    <section class="estante-bloco">
      <h2>Abertos recentemente ${lidos.length ? '<button class="botao botao--discreto" type="button" data-limpar-historico>Limpar</button>' : ''}</h2>
      ${blocoRecentes}
    </section>`;
  // seta "voltar" virada para a direita nos itens recentes
  for (const seta of document.querySelectorAll('.recente > .icone')) seta.style.transform = 'scaleX(-1)';
}

// ---------------------------------------------------------------- tela: sobre

function desenharSobre() {
  const { catalogo, obras } = estado;
  const comPdf = obras.filter(o => o.formatos.has('pdf')).length;
  const comEpub = obras.filter(o => o.formatos.has('epub')).length;
  const data = new Date(catalogo.geradoEm);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  $('#sobre-conteudo').innerHTML = `
    <p>O <strong>Acervo Digital</strong> reúne em um só lugar as obras que a Livraria do Senado Federal
      oferece gratuitamente em formato digital, para encontrar e ler direto no celular.</p>
    <div class="numeros">
      <div class="numero"><strong>${obras.length}</strong><span>obras gratuitas</span></div>
      <div class="numero"><strong>${comPdf}</strong><span>com PDF</span></div>
      <div class="numero"><strong>${comEpub}</strong><span>com EPUB</span></div>
      <div class="numero"><strong>${catalogo.categorias.length}</strong><span>categorias</span></div>
    </div>
    <p class="nota">Catálogo atualizado em ${data.toLocaleDateString('pt-BR')} às
      ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })},
      a partir de ${catalogo.produtosLidos} títulos da <a href="${escapar(catalogo.fonte)}" target="_blank" rel="noopener">Livraria do Senado</a>.</p>

    <h2>De onde vêm os arquivos</h2>
    <p>Os PDFs e EPUBs ficam na Biblioteca Digital do Senado Federal (BDSF). O app não guarda cópias:
      ele apenas organiza os links e abre o arquivo no leitor do aparelho.</p>

    <h2>Instalar no celular</h2>
    ${instalado ? '<p>O app já está instalado neste aparelho.</p>'
      : ios ? '<p>No Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>'
      : `<p>No Chrome, abra o menu <strong>⋮</strong> e toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).</p>
         ${estado.pedidoInstalacao ? '<button class="botao botao--primario" type="button" data-instalar>Instalar agora</button>' : ''}`}

    <h2>Sua estante</h2>
    <p>As obras salvas e o histórico de leitura ficam guardados só neste aparelho.</p>

    <p class="nota">Protótipo para demonstração interna — versão 0.1. Ainda não é um serviço oficial do
      Senado Federal.</p>`;
}

// ---------------------------------------------------------------- navegação

const TELAS = ['acervo', 'obra', 'estante', 'sobre'];

function mostrarTela(nome) {
  if (estado.telaAtual === 'acervo' && nome !== 'acervo') estado.rolagemAcervo = window.scrollY;
  for (const t of TELAS) $(`#tela-${t}`).hidden = t !== nome;
  const aba = nome === 'obra' ? 'acervo' : nome;
  for (const a of document.querySelectorAll('.aba')) {
    if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const anterior = estado.telaAtual;
  estado.telaAtual = nome;
  return anterior;
}

function rotear() {
  const [rota, ...resto] = location.hash.replace(/^#\/?/, '').split('/');
  const parametro = decodeURIComponent(resto.join('/'));

  if (rota === 'obra') {
    mostrarTela('obra');
    desenharObra(parametro);
    window.scrollTo(0, 0);
    return;
  }

  document.title = 'Acervo Digital · Livraria do Senado';
  if (rota === 'estante') { mostrarTela('estante'); desenharEstante(); window.scrollTo(0, 0); return; }
  if (rota === 'sobre') { mostrarTela('sobre'); desenharSobre(); window.scrollTo(0, 0); return; }

  const anterior = mostrarTela('acervo');
  desenharVitrines();
  if (rota === 'categoria' && estado.nomesCategorias.has(parametro)) {
    $('#campo-busca').value = ''; $('#limpar-busca').hidden = true;
    definirFiltro({ busca: '', categoria: parametro, formato: 'todos' });
    window.scrollTo(0, 0);
  } else if (anterior && anterior !== 'acervo') {
    requestAnimationFrame(() => window.scrollTo(0, estado.rolagemAcervo));
  }
}

// ---------------------------------------------------------------- início

async function iniciar() {
  // Capas que não carregam dão lugar à capa desenhada.
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG' && e.target.closest('.capa')) e.target.remove();
  }, true);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    estado.pedidoInstalacao = e;
    $('#botao-instalar').hidden = false;
  });
  document.addEventListener('click', async e => {
    if (!e.target.closest('#botao-instalar, [data-instalar]') || !estado.pedidoInstalacao) return;
    estado.pedidoInstalacao.prompt();
    await estado.pedidoInstalacao.userChoice;
    estado.pedidoInstalacao = null;
    $('#botao-instalar').hidden = true;
  });

  $('#tela-obra').addEventListener('click', aoClicarNaObra);
  $('#tela-estante').addEventListener('click', e => {
    if (!e.target.closest('[data-limpar-historico]')) return;
    recentes = [];
    memoria.gravar(CHAVES.recentes, recentes);
    desenharEstante();
    avisar('Histórico apagado.');
  });

  try {
    const resposta = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    carregarCatalogo(await resposta.json());
  } catch (erro) {
    console.error(erro);
    $('#carregando').innerHTML = `<p><strong>Não foi possível carregar o acervo.</strong></p>
      <p>Verifique sua conexão e tente de novo.</p>
      <button class="botao" type="button" onclick="location.reload()">Tentar de novo</button>`;
    return;
  }

  $('#carregando').remove();
  montarAcervo();
  window.addEventListener('hashchange', () => { estado.navegouNoApp = true; rotear(); });
  rotear();

  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('sw.js').catch(erro => console.warn('Service worker não registrado:', erro));
  }
}

iniciar();

/* « Comment lire » : une explication courte, ouverte à la demande, sur les cartes aux indicateurs techniques.
 * Le bouton se place juste après le titre (pas dedans : certains titres sont réécrits par leur graphique). */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const HELP = {
    // Compétitions
    'card-level': 'La moyenne de l’indice VDOT de mes 10 dernières courses sur route gomme les jours sans et les parcours piégeux : c’est la mesure la plus fiable de mon niveau du moment. Le marathon la tire souvent vers le bas, car la fatigue de fin de course n’entre pas dans la formule.',
    'card-vdot': 'Le <b>VDOT</b> est un indice de niveau imaginé par l’entraîneur Jack Daniels : à partir du chrono et de la distance d’une course, il estime ma capacité aérobie. Il rend comparables un 10 km et un marathon. Repères sur 10 km : 50 ≈ 41′, 55 ≈ 38′, 60 ≈ 35′20″, 65 ≈ 33′, 70 ≈ 31′. Je ne le calcule que sur route : le dénivelé fausserait le calcul.',
    'card-predict': 'Les chronos que laisse espérer mon meilleur VDOT des 12 derniers mois, pour une course préparée sur un parcours plat. Sur marathon, l’équivalence est souvent optimiste : elle suppose une endurance spécifique que le VDOT ne mesure pas.',
    'card-facets': 'Allure réelle = chrono ÷ distance officielle de l’épreuve, pas la distance GPS (souvent un peu plus longue). Les échelles sont alignées d’une distance à l’autre : plus haut = plus rapide.',
    'card-pacesplit': 'J’y compare l’allure de la 2e moitié de chaque course à celle de la 1re. Au-dessus de zéro, j’ai ralenti (<b>positive split</b>) ; en dessous, j’ai fini plus vite (<b>négative split</b>). Entre −1 % et +2 %, l’effort est bien réparti.',
    // Objectif
    'card-goalbuild': 'La forme est ma charge d’entraînement moyenne sur 42 jours, calculée d’après la fréquence cardiaque. Je la compare, jour pour jour, à ma préparation de la dernière édition : à forme égale au même moment, je peux viser le même chrono.',
    // Entraînement
    'card-vol': 'Les barres sont les km de chaque semaine, la courbe leur moyenne glissante. Les semaines en bleu dépassent 90 km : c’est le volume de mes meilleurs blocs de préparation.',
    'card-volrace': 'Chaque point est une course sur route : en abscisse, mes km par semaine sur les 8 semaines d’avant ; en hauteur, le VDOT obtenu. La pente de la tendance montre ce que le volume m’apporte le jour de la course.',
    'card-qweeks': 'Une séance compte comme dure quand les tours de la montre montrent assez de travail rapide, à moins de 20 % de l’allure de mon meilleur 10 km des 12 derniers mois ; sans tours, quand au moins 15 % du temps se passe en zones 4 et 5.',
    'card-easyweeks': 'Un footing devrait rester facile, en zone 1 ou 2. Quand il glisse au-dessus, c’est la <b>zone grise</b> : trop dur pour bien récupérer, pas assez pour progresser. Je mesure la part du temps passée au-dessus de la zone 2 : facile sous 10 %, limite de 10 à 30 %, zone grise au-delà. Un footing, ici, c’est une sortie qui n’est ni une séance ni une compétition.',
    'card-ramp': 'Les km de chaque semaine comparés à la moyenne des 4 précédentes. Une hausse de plus de 30 % d’une semaine à l’autre est brutale : c’est le repère classique pour limiter le risque de blessure, surtout en reprise.',
    'card-acwr': 'Charge des 7 derniers jours ÷ moyenne hebdomadaire des 28 derniers. Entre 0,8 et 1,3, je monte en charge au rythme de ce que mon corps a l’habitude d’encaisser ; au-delà de 1,5, le risque de blessure augmente nettement. C’est un repère courant, pas une règle absolue.',
    'card-reprises': 'Une coupure, c’est au moins 2 semaines sous la moitié de mon volume habituel. Je suis ensuite la remontée semaine par semaine, jusqu’au retour à 85 % de mon volume d’avant : une reprise trop rapide est le moment où l’on se blesse le plus.',
    'card-recov': 'Jours entre chaque course et ma séance dure suivante : fractionné, autre course, ou sortie à l’effort relatif d’au moins 70 (score tiré de la fréquence cardiaque). Plus la course est longue, plus il faut de jours avant de pouvoir refaire un effort de qualité.',
    'card-density': 'Le nombre de courses dans les 8 semaines qui se terminent à chaque semaine. Enchaîner les courses laisse moins de place aux blocs d’entraînement qui font progresser.',
    'card-efforts': 'Mes meilleurs temps sur des distances repères, mesurés par la montre pendant n’importe quelle sortie, course ou entraînement : ce ne sont pas forcément des chronos officiels.',
    // Forme & cardio
    'card-load': 'Chaque jour reçoit une charge : l’effort de mes séances, calculé d’après la fréquence cardiaque (tous sports). La <b>forme</b> est sa moyenne sur 42 jours : ce que j’ai construit. La <b>fatigue</b>, sur 7 jours : ce que je viens d’encaisser. La <b>fraîcheur</b> est la différence : très négative en plein bloc, positive après quelques jours calmes, idéalement juste avant une course.',
    'card-loadweeks': 'La charge d’une semaine additionne l’effort de chaque séance, calculé d’après la fréquence cardiaque : une heure facile compte peu, une séance au seuil ou une course beaucoup.',
    'card-zoneyears': 'Mes zones de fréquence cardiaque, de la plus facile (zone 1, récupération) à la plus dure (zone 5, effort maximal). Un entraînement d’endurance équilibré passe environ 80 % du temps en zones 1 et 2. Seules les années d’au moins 20 sorties avec cardio sont montrées.',
    'card-hrpace': 'À allure égale sur le plat, un cœur qui bat moins vite qu’avant est le signe d’une meilleure forme aérobie. Chaque courbe est une année : plus elle est basse, mieux c’est.',
    'card-eff': 'Vitesse ÷ fréquence cardiaque : les mètres parcourus à chaque battement. Je ne garde que des sorties comparables : faciles (FC moyenne en zone 1 ou 2), régulières, de 5 km et plus, hors compétitions. Quand ce chiffre monte, je cours plus vite pour le même effort : mon endurance progresse.',
    'card-drift': 'Sur une sortie longue (1 h et plus) à allure régulière, le cœur monte peu à peu pour la même vitesse : chaleur, déshydratation, fatigue. Je mesure la perte d’efficacité entre la 1re et la 2e moitié : sous 5 %, l’endurance tient bien.',
    'card-grade': 'Mesuré à l’intérieur de chaque sortie : de combien je ralentis, et de combien mon cœur monte, en côte et en descente par rapport au plat, selon la pente.',
    'card-cadpace': 'La cadence est le nombre de pas par minute. Elle monte naturellement avec la vitesse ; à allure égale, une cadence plus élevée va souvent avec une foulée plus courte et moins d’impact à chaque pas.',
    // Carte
    'card-loop': 'Même parcours, mêmes repères : l’allure de chaque passage montre directement l’évolution de ma forme, et sa couleur dit si l’effort était facile ou dur (FC moyenne).',
    'card-seg': 'Un segment est une portion de parcours chronométrée à chaque passage (une côte, un quai, une ligne droite) : le terrain ne change pas, donc les temps se comparent directement.',
  };

  let n = 0;
  Object.entries(HELP).forEach(([id, html]) => {
    const card = document.getElementById(id);
    const head = card && card.querySelector('.sr-card__head');
    const title = head && head.querySelector('.sr-card__title');
    if (!title) return;
    n += 1;
    const panel = SR.el('div', 'sr-help');
    panel.id = `help-${n}`;
    panel.hidden = true;
    const p = document.createElement('p');
    p.innerHTML = html;
    panel.append(p);
    const btn = SR.el('button', 'sr-info');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', panel.id);
    btn.setAttribute('aria-label', 'Comment lire ce graphique');
    btn.title = 'Comment lire ce graphique';
    btn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="6.2" r="1.05" fill="currentColor"/></svg>';
    title.after(btn);
    head.after(panel);
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.sr-info');
    if (!btn) return;
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  });
})();

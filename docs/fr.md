# Rain Bird

Suivez et pilotez votre **programmateur d'arrosage Rain Bird** depuis Gladys,
sur votre réseau local : voyez quelle zone arrose, si le capteur de pluie
détecte la pluie et si un délai de pluie suspend le programme ; arrosez une
zone quelques minutes, arrêtez tout, lancez un programme, ou suspendez le
programme pour les jours de pluie annoncés. Ni compte Rain Bird ni cloud :
Gladys parle directement au module Wi-Fi du programmateur.

> **Développée sans le matériel : vos retours sont bienvenus.** Cette
> intégration a été construite à partir du protocole de la bibliothèque libre
> [pyrainbird](https://github.com/allenporter/pyrainbird) et des réponses de
> vrais programmateurs enregistrées dans ses tests et dans ceux de Home
> Assistant, pas sur un vrai programmateur. Si quelque chose ne fonctionne pas
> comme décrit, dites-le sur le
> [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-rainbird/issues).

Cette intégration n'est ni affiliée à Rain Bird Corporation, ni approuvée par
elle.

## Ce qu'il vous faut

- Gladys Assistant 5.2.0 ou plus récent.
- Un programmateur Rain Bird avec **module Wi-Fi LNK ou LNK2** (ESP-TM2,
  ESP-Me, ESP-ME3, ESP-RZXe, ST8x-WiFi, ARC8, TRU…), déjà installé avec
  l'appli Rain Bird et connecté à votre Wi-Fi.
- L'**adresse IP** du module sur votre réseau : cherchez-la dans la liste des
  appareils de votre box. Donnez-lui une adresse fixe (réservation DHCP) pour
  qu'elle ne change pas.
- Le **mot de passe du programmateur** choisi dans l'appli Rain Bird à
  l'installation du module. Il chiffre chaque échange avec le module.

Le module ne sert **qu'un client à la fois** et répond lentement. Pendant que
Gladys le lit (quelques secondes chaque minute par défaut), l'appli Rain Bird
peut devoir attendre ou afficher une erreur : réessayez un instant plus tard,
ou choisissez un intervalle de lecture plus long.

## Configuration

1. Installez l'intégration depuis le catalogue de Gladys.
2. Dans **Configuration**, saisissez l'**Adresse** du module (par exemple
   `192.168.1.20`), son **Mot de passe du module**, et si vous voulez un
   **Nom**. Deux ou trois programmateurs ? Remplissez aussi les sections
   _Deuxième programmateur_ et _Troisième programmateur_.
3. Choisissez les options : **Arrosage par l'interrupteur d'une zone (min)**
   (10 par défaut), l'**Intervalle de lecture** (1 minute par défaut, 2 ou 5
   minutes pour laisser le module plus libre pour l'appli) et la **Langue des
   noms de fonctionnalités**.
4. Enregistrez, puis cliquez sur **Tester la connexion** : le message sous le
   bouton donne, pour chaque programmateur, son modèle, ses zones, ce qui
   arrose, le capteur de pluie et le délai de pluie.
5. Ouvrez l'onglet **Découverte** : un appareil par programmateur. Cliquez sur
   **Ajouter**, choisissez une pièce, enregistrez.

L'adresse peut aussi s'écrire `https://192.168.1.20` ou `http://192.168.1.20` :
sans préfixe, l'intégration essaie d'abord le HTTPS (les firmwares LNK2 récents,
avec leur certificat auto-signé) puis le HTTP (les plus anciens), et garde celui
qui répond.

## L'appareil de chaque programmateur

L'appareil porte le **Nom** de la configuration, ou « Rain Bird » suivi du
modèle. Il est identifié par l'adresse MAC de son module Wi-Fi : changer
l'adresse IP du programmateur garde l'appareil et son historique.

| Fonctionnalité                                                     | Ce qu'elle fait                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zone 1**, **Zone 2**… (une par zone câblée sur le programmateur) | Un interrupteur, allumé pendant que la zone arrose. L'allumer arrose la zone pendant les minutes de la configuration (le programmateur l'arrête tout seul) ; l'éteindre **arrête l'arrosage de toutes les zones** : le programmateur n'a pas de commande « arrêter cette zone seulement ». |
| **Capteur de pluie**                                               | Allumé (1) quand le capteur de pluie câblé sur le programmateur détecte la pluie. Reste éteint sans capteur. Absent si le programmateur refuse cette lecture.                                                                                                                              |
| **Délai de pluie**                                                 | Les jours pendant lesquels le programme reste suspendu (0 : aucun). Un curseur de 0 à 14 jours (30 sur les modèles BAT-PRO et LX) : le déplacer règle le délai sur le programmateur.                                                                                                       |
| **En ligne**                                                       | Allumé tant que le programmateur répond ; éteint après deux lectures de suite sans réponse.                                                                                                                                                                                                |
| **Arrêter l'arrosage**                                             | Un bouton : arrête toutes les zones.                                                                                                                                                                                                                                                       |
| **Lancer le programme A**, **Lancer le programme B**…              | Un bouton par programme du modèle (A à H au plus ; aucun sur l'ESP-RZXe et le ST8x-WiFi, qui programment chaque zone séparément) : lance le programme maintenant, comme à son heure de départ.                                                                                             |

Rain Bird nomme les zones dans son appli, dans le cloud : l'intégration ne les
lit pas. Renommez les fonctionnalités dans Gladys (réglages de l'appareil) en
« Pelouse », « Potager »…

Les fonctionnalités sont créées dans la **Langue des noms de fonctionnalités**
de la configuration (le français par défaut) et gardent ensuite leur nom.

## Tableau de bord

Le widget **Rain Bird** montre un programmateur (celui choisi dans ses
réglages, ou le premier de la configuration) :

- les zones, celles qui arrosent en premier, avec un badge **Arrosage** ou
  **Au repos** (8 au plus ; le nombre des autres est indiqué dessous) ;
- le capteur de pluie, le délai de pluie, et la connexion quand le
  programmateur ne répond pas ;
- quatre boutons : **Arroser…** (choisir la zone et les minutes), **Arrêter**
  (toutes les zones ; une coche quand rien n'arrose), **Programme…** (choisir
  le programme ; absent si le modèle n'en a pas) et **Délai de pluie…**
  (choisir les jours, 0 annule le délai).

## Scènes

### Déclencheurs

- **Arrosage Rain Bird démarré** : une zone commence à arroser. Filtres : le
  programmateur, la zone, et **Lancé par** : _Le programmateur (programme,
  appli)_ ou _Gladys_. Informations transmises : la zone, qui l'a lancé, le nom
  du programmateur.
- **Arrosage Rain Bird terminé** : une zone cesse d'arroser. Mêmes filtres.
  Informations transmises : la zone, les **minutes d'arrosage** vues par Gladys
  (à l'intervalle de lecture près ; vide si l'arrosage a commencé avant
  l'intégration), qui l'a lancé, le nom du programmateur.

Un arrosage est vu à la lecture suivante : avec un intervalle d'une minute, un
début ou une fin apparaît en moins d'une minute. L'interrupteur d'une zone
donne déjà « zone allumée/éteinte » aux scènes ; ces déclencheurs ajoutent qui
l'a lancé, combien de temps elle a arrosé, et un seul déclencheur pour toutes
les zones.

### Actions

- **Arroser une zone Rain Bird** : un programmateur, un numéro de zone, une
  durée en minutes (10 par défaut). Le programmateur arrête la zone tout seul.
- **Arrêter l'arrosage Rain Bird** : toutes les zones d'un programmateur, ou de
  tous si le programmateur est laissé vide.
- **Lancer un programme Rain Bird** : un programmateur et un programme (A à H).
- **Régler le délai de pluie Rain Bird** : un programmateur et un nombre de
  jours (0 annule le délai ; plafonné à la limite du modèle).

### Idées de scènes

- **Pluie annoncée** : quand la météo annonce de la pluie pour demain,
  **Régler le délai de pluie Rain Bird** à 2 jours.
- **Quelqu'un au jardin** : quand le portillon du jardin s'ouvre, **Arrêter
  l'arrosage Rain Bird**.
- **Compte rendu d'arrosage** : sur **Arrosage Rain Bird terminé** lancé par
  _Le programmateur_, envoyer le message « Zone {zone} arrosée {minutes} min ».
- **Semis** : chaque jour à 14 h pendant une canicule, **Arroser une zone Rain
  Bird** : la zone du potager pendant 5 minutes.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse (elle a pu changer : donnez au
  module une adresse fixe dans votre box), que le programmateur est alimenté et
  que le voyant Wi-Fi du module est allumé. Gladys doit pouvoir joindre le
  réseau du module.
- **« mot de passe refusé (ou pas un module Rain Bird) »** : ressaisissez le
  mot de passe du programmateur (celui de l'appli Rain Bird, majuscules
  comprises). Vérifiez aussi que l'adresse est bien celle du module Rain Bird. Après un mot de passe refusé, l'intégration ne réessaie que toutes les 10 minutes (le module peut bloquer les tentatives répétées) ; enregistrer la configuration réessaie tout de suite.
- **« occupé avec un autre client »** : l'appli Rain Bird (ou une autre
  domotique) parlait au module. L'intégration réessaie quelques fois, puis à la
  lecture suivante. Deux systèmes qui lisent le module chaque minute se
  gêneront sans cesse : n'en gardez qu'un.
- **L'appli Rain Bird n'arrive pas à se connecter** : le module est occupé
  avec Gladys quelques secondes ; réessayez, ou choisissez un intervalle de
  lecture de 2 ou 5 minutes.
- **L'interrupteur d'une zone revient en arrière** : le programmateur a refusé
  ou ignoré la commande. L'intégration relit le programmateur cinq secondes après chaque commande et affiche ce
  qu'il fait vraiment.
- **Une nouvelle zone manque** : cliquez sur **Rechercher** dans l'onglet
  Découverte (ou sur **Tester la connexion**), puis **Mettre à jour**
  l'appareil.
- **Plus de détails** : démarrez l'intégration avec `LOG_LEVEL=debug` pour voir
  chaque lecture dans ses logs. Les mots de passe et les réglages Wi-Fi n'y
  apparaissent jamais.

## Limites

- **Développée sans le matériel : vos retours sont bienvenus.** Testée contre
  les réponses enregistrées de vrais programmateurs, pas contre un vrai
  programmateur.
- Réseau local seulement, par un module Wi-Fi LNK ou LNK2 : un programmateur
  qui n'en a pas (Bluetooth seul, ou cloud seul) n'est pas joignable ainsi.
- L'intégration lit le programmateur au plus une fois par minute (le module ne
  sert qu'un client à la fois) : un arrosage lancé depuis le programmateur
  apparaît dans l'intervalle de lecture.
- Pas de noms de zones (ils sont dans le cloud Rain Bird) ni de modification du
  programme.
- Éteindre une zone arrête toutes les zones (la seule commande d'arrêt du
  programmateur). Lancer une zone pendant qu'une autre arrose : selon le
  modèle, le programmateur arrête la première ou met la nouvelle en file
  d'attente.
- Durées de 1 à 240 minutes (moins si la limite du modèle est plus basse).

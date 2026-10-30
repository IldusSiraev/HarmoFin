# Changelog

## [1.10.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.9.0...v1.10.0) (2026-10-30)


### Новое

* API событий и лента семейного календаря ([4d53766](https://github.com/IldusSiraev/HarmoFin/commit/4d53766677282e5eb8791ed5fa38ff32aa90f323))

## [1.9.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.8.0...v1.9.0) (2026-10-30)


### Новое

* **api:** разворачивание повторов событий календаря ([a97f578](https://github.com/IldusSiraev/HarmoFin/commit/a97f578fcd91b81b78e43d39fdc9db1e109a82be))
* **db:** таблицы событий семейного календаря ([0de1768](https://github.com/IldusSiraev/HarmoFin/commit/0de1768528a069f0f8470dc4965ed7b329bc603c))
* **worker:** копия разворачивания повторов для напоминаний ([743c67e](https://github.com/IldusSiraev/HarmoFin/commit/743c67ebd8a98c96f43fcb64b2e7f7b00fe98c77))
* данные и повторения семейного календаря ([500e72a](https://github.com/IldusSiraev/HarmoFin/commit/500e72a339b2474c28e7f63976c8f9b4e1aef165))

## [1.8.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.7.1...v1.8.0) (2026-10-29)


### Новое

* **api:** владелец конверта, цели и правила наполнения только своих конвертов ([760a62b](https://github.com/IldusSiraev/HarmoFin/commit/760a62b19121db1f8397490c6e82cc161dfb45ff))
* **api:** владелец счёта и права на изменение ([8cd80c9](https://github.com/IldusSiraev/HarmoFin/commit/8cd80c98c300960d9a74801d83d563224add81cc))
* **api:** история конверта с автором, направлением и контрагентом ([9394983](https://github.com/IldusSiraev/HarmoFin/commit/9394983171483bc276a392b00ae0d76e159ff108))
* **api:** операции и переводы только по своему счёту, правка только своих ([30b9869](https://github.com/IldusSiraev/HarmoFin/commit/30b98691716a91203883b6641f59e6b2692df006))
* **api:** передача объектов создателю при выходе и удалении участника ([eb17a79](https://github.com/IldusSiraev/HarmoFin/commit/eb17a79656dd20f1c91a15f6bca6ffd6aefa1ff3))
* **api:** планом управляет и записывает платежи и доходы его владелец ([4b0ec7e](https://github.com/IldusSiraev/HarmoFin/commit/4b0ec7e564889e30818fb543d3f87afa461e71da))
* **api:** политика доступа семьи и общие ссылки на участников ([e92816b](https://github.com/IldusSiraev/HarmoFin/commit/e92816bd2aca388649d38dcae8028884f111e01a))
* **api:** правила распределения и перемещения денег по владельцу и автору ([140cef9](https://github.com/IldusSiraev/HarmoFin/commit/140cef90e09aef912b9883e6eb42f587428f0b32))
* **db:** владелец счетов, конвертов и планов, автор распределений и перемещений ([cddf0ef](https://github.com/IldusSiraev/HarmoFin/commit/cddf0ef0621d429faf537552e8e9193c5bc26c94))
* **web:** владелец счёта, правка только своих счетов ([1a776c4](https://github.com/IldusSiraev/HarmoFin/commit/1a776c4a0e093aaae51839f56fa0282c8fd15137))
* **web:** конверты по владельцу, история с авторами ([8cdf53f](https://github.com/IldusSiraev/HarmoFin/commit/8cdf53f6675303bbd56645301e919c74bbfd18eb))
* **web:** операции по своим счетам, правка только своих операций ([15392c1](https://github.com/IldusSiraev/HarmoFin/commit/15392c10d8a19d46d8482103e939cde4053e76f2))
* **web:** планы по владельцу, уведомление о переданных объектах ([9352137](https://github.com/IldusSiraev/HarmoFin/commit/93521378b1e7d778c2cdf044961c0f0f032d2b58))
* **web:** подпись владельца и фильтр «Все / Мои» ([be1116d](https://github.com/IldusSiraev/HarmoFin/commit/be1116d554aaea699129098037e778ef8b100bc0))
* **worker:** плановые уведомления получает владельца плана ([7a0d533](https://github.com/IldusSiraev/HarmoFin/commit/7a0d53356e4816c7cfceb320d6933a386578462f))
* семейный доступ, этап B — владение объектами ([3f08471](https://github.com/IldusSiraev/HarmoFin/commit/3f08471b1072d280b2fbb7360c1f8a16ca8dbb2c))


### Исправления

* **ci:** e2e и integration после этапа B ([c4fb39b](https://github.com/IldusSiraev/HarmoFin/commit/c4fb39bc12d925770f5239ee87008267a5d6c3e6))
* **e2e:** закрывать календарь после ввода даты в сценарии владения ([61f531b](https://github.com/IldusSiraev/HarmoFin/commit/61f531b0fbe60596bed0acf0a913d94915556831))
* **web:** не пересчитывать распределение при повторной фиксации той же суммы ([dc66eae](https://github.com/IldusSiraev/HarmoFin/commit/dc66eae89e4b900d63d9ef56c24c913f692e13cf))
* **web:** подпись владельца в оффере пополнения из ссылок на конверты ([1c3d028](https://github.com/IldusSiraev/HarmoFin/commit/1c3d0284189e14672f91d5508092cafa9ca6428d))

## [1.7.1](https://github.com/IldusSiraev/HarmoFin/compare/v1.7.0...v1.7.1) (2026-10-26)


### Исправления

* окно покрытия перерасхода и оплаченные планы в календаре ([411ff31](https://github.com/IldusSiraev/HarmoFin/commit/411ff315a9c10416f461022666e0438d9242354b))
* окно покрытия перерасхода и оплаченные планы в календаре ([f628658](https://github.com/IldusSiraev/HarmoFin/commit/f62865854972935ecf8c392b63bacae8569c0f0e))

## [1.7.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.6.1...v1.7.0) (2026-10-26)


### Новое

* **api:** автор операции в журнале и фильтр по автору ([741a895](https://github.com/IldusSiraev/HarmoFin/commit/741a8957335ff7e7f845215e936c486ce081e628))
* **api:** доменные правила приглашений в семью ([b6f97cc](https://github.com/IldusSiraev/HarmoFin/commit/b6f97ccf512ee13abc2777db693507633aa2865f))
* **api:** приглашения в семью с письмом и ссылкой ([52fe779](https://github.com/IldusSiraev/HarmoFin/commit/52fe77926d5a769480ee910999b535dc3dc691e4))
* **api:** принятие приглашения и регистрация по ссылке ([3b303c2](https://github.com/IldusSiraev/HarmoFin/commit/3b303c255d73ad201cf4e867165d5ff8dec4b222))
* **api:** репозиторий семьи и личное пространство ([5c560a3](https://github.com/IldusSiraev/HarmoFin/commit/5c560a30e0642d39a927ecdbb9dbc0086222edd3))
* **api:** удаление аккаунта участника уведомляет создателя семьи ([571abc2](https://github.com/IldusSiraev/HarmoFin/commit/571abc253051702b60cfedc11c1875c444fad088))
* **api:** участники семьи, выход и выбор пространства ([ae3d5c2](https://github.com/IldusSiraev/HarmoFin/commit/ae3d5c2fac36fcd4fcd06a6e67d03794abc24021))
* **db:** приглашения в семью и выбор пространства ([3c6aa78](https://github.com/IldusSiraev/HarmoFin/commit/3c6aa78f4b8b3739a1a007d0452c9951bb75dc25))
* **web:** автор операции в журнале и фильтр по автору ([3fb9e6a](https://github.com/IldusSiraev/HarmoFin/commit/3fb9e6a1ed655b1760645e818f6a6baad1a3fb83))
* **web:** активное пространство и переключатель семьи ([4d8c091](https://github.com/IldusSiraev/HarmoFin/commit/4d8c091be8161db0d3e570845764f4366b5e13d5))
* **web:** действия в интерфейсе по роли участника ([95204f3](https://github.com/IldusSiraev/HarmoFin/commit/95204f3096b131f8ae97f05235499c24b51dbee4))
* **web:** принятие приглашения по ссылке ([ea261c2](https://github.com/IldusSiraev/HarmoFin/commit/ea261c2da2e45bcdbb5507ea8e6c0c07ff79d8a5))
* **web:** страница «Семья» и приглашение участников ([6ef672e](https://github.com/IldusSiraev/HarmoFin/commit/6ef672ec7f2e446a647cdcd0bdb0b62be89fc37c))
* **worker:** плановые уведомления всем участникам семьи ([de02fb7](https://github.com/IldusSiraev/HarmoFin/commit/de02fb7ceb1e901a2df4042d1ed66244ebc18955))
* семейный доступ (этап A) ([4385348](https://github.com/IldusSiraev/HarmoFin/commit/43853484ed361e8812f965ce859cfb0bc4b73018))


### Исправления

* **ci:** починка integration и e2e для доступа семьи ([584efb0](https://github.com/IldusSiraev/HarmoFin/commit/584efb0e784665d98253596d259f66bdfe657c75))
* **worker:** очистка аккаунта учитывает приглашения в семью ([4cc0312](https://github.com/IldusSiraev/HarmoFin/commit/4cc031278eee43dbefa8e1750385752d50a665d8))
* восстановление аккаунта без пространств, аудит и мелкие правки семьи ([5b910d8](https://github.com/IldusSiraev/HarmoFin/commit/5b910d898d0f644ae7281ea880e0bc653f5ef272))

## [1.6.1](https://github.com/IldusSiraev/HarmoFin/compare/v1.6.0...v1.6.1) (2026-10-24)


### Исправления

* **api:** деньги в ещё не начавшемся периоде считаются отложенными ([3672c5d](https://github.com/IldusSiraev/HarmoFin/commit/3672c5d69b147a498d716a75e5034882cb1538fc))
* **deps:** обновить zod, happy-dom и undici из-за уязвимостей ([c846f17](https://github.com/IldusSiraev/HarmoFin/commit/c846f17ba8b8d25d7774e3f97758aff423e67160))
* **deps:** обновить zod, happy-dom и undici из-за уязвимостей ([9346ed5](https://github.com/IldusSiraev/HarmoFin/commit/9346ed569e29654d05b2552a79391c0c1d7fea54))

## [1.6.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.5.0...v1.6.0) (2026-10-23)


### Новое

* **api:** распределение по всем конвертам и нулевые строки ([4c7476a](https://github.com/IldusSiraev/HarmoFin/commit/4c7476a510eda0cdf66495b038b4a21377707181))
* **web:** аккуратный скролл в стиле Calm Fintech ([b1ec5a8](https://github.com/IldusSiraev/HarmoFin/commit/b1ec5a832eb754e2f0343d10fbf3f0ca96fd6fe1))
* **web:** окно распределения со всеми конвертами ([9547f0c](https://github.com/IldusSiraev/HarmoFin/commit/9547f0c4ab65b83ac104ec289453b2b47c8118a1))
* окно распределения со всеми конвертами и аккуратный скролл ([a140198](https://github.com/IldusSiraev/HarmoFin/commit/a140198ed6bc754c5b6de520ced766ee7ea7a769))


### Исправления

* **api:** preview создаёт периоды до расчёта хеша ([5ef2eac](https://github.com/IldusSiraev/HarmoFin/commit/5ef2eacfb81aeecb2d19faf2ad1c34775510b5f9))

## [1.5.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.4.0...v1.5.0) (2026-10-22)


### Новое

* новая раскладка дашборда по прототипу и поля покрытия в API ([3aee35f](https://github.com/IldusSiraev/HarmoFin/commit/3aee35f46df7e64fce33d07189ef0b4c0005c519))

## [1.4.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.3.1...v1.4.0) (2026-10-22)


### Новое

* **web:** цвета типов для счетов, конвертов на главной и операций ([ccb2ddc](https://github.com/IldusSiraev/HarmoFin/commit/ccb2ddc8dd1e491d0c601b2f16a1c5e119d7d4d8))

## [1.3.1](https://github.com/IldusSiraev/HarmoFin/compare/v1.3.0...v1.3.1) (2026-10-22)


### Исправления

* **infra:** удаление старых образов после деплоя и ротация логов ([5deb902](https://github.com/IldusSiraev/HarmoFin/commit/5deb9022212f4d26e76d8fcb4d1f694fec9968da))
* **infra:** удаление старых образов после деплоя и ротация логов ([f7bc050](https://github.com/IldusSiraev/HarmoFin/commit/f7bc0501c98ea32d4b0822a72eaa1268f4f725be))

## [1.3.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.2.1...v1.3.0) (2026-10-22)


### Новое

* **web:** «Переложить» с предпросмотром и быстрым выбором получателя ([9d354bc](https://github.com/IldusSiraev/HarmoFin/commit/9d354bc2ea93f901c4ba141beef440ec29dd560c))
* **web:** «Правила пополнения» в новом оформлении ([3f51ef6](https://github.com/IldusSiraev/HarmoFin/commit/3f51ef6e773c1ef1067a1e7d3787a1a508014288))
* **web:** «Распределить деньги» в новом оформлении ([5e6deef](https://github.com/IldusSiraev/HarmoFin/commit/5e6deef928d3e8a190dc8b47fc876f9cd96ddf10))
* **web:** детали конверта в новом оформлении ([8a59f2b](https://github.com/IldusSiraev/HarmoFin/commit/8a59f2b57f3f0e37087b766bc6b261e9e0d2820b))
* **web:** карточки конвертов с цветом типа, прогрессом и поиском ([715c363](https://github.com/IldusSiraev/HarmoFin/commit/715c363643973f9d37b5360c56d2343b52ee8c6d))
* **web:** редизайн раздела «Конверты» ([fefe6d1](https://github.com/IldusSiraev/HarmoFin/commit/fefe6d1a2c0aedafbc5a3dc57c76cdcc9725ced6))
* **web:** сводка и действия на странице конвертов ([b5a5875](https://github.com/IldusSiraev/HarmoFin/commit/b5a58750c07ec9f13cc052b0aeed8a8741c3ebba))
* **web:** строки внимания, крупная сумма и предпросмотр «было → стало» ([e772e2f](https://github.com/IldusSiraev/HarmoFin/commit/e772e2fe69f5c4647b9d926c42b13f803ac71198))
* **web:** цвета типов конвертов и иконка типа ([37089de](https://github.com/IldusSiraev/HarmoFin/commit/37089de943d35d5767142aa8e13e9bd6e81f56f9))


### Исправления

* **web:** конверты — выравнивание вёрстки по макету ([3887931](https://github.com/IldusSiraev/HarmoFin/commit/38879314bf8426a74db711d27367617b885311e8))
* **web:** конверты — замечания финального ревью ([780d548](https://github.com/IldusSiraev/HarmoFin/commit/780d54875cb40fade4be5cde89ce09a6883d1652))

## [1.2.1](https://github.com/IldusSiraev/HarmoFin/compare/v1.2.0...v1.2.1) (2026-10-21)


### Исправления

* **deps:** vite 8.3.4 вместо уязвимой 8.2.2 у vite-node ([e17d5af](https://github.com/IldusSiraev/HarmoFin/commit/e17d5afbfaaf730c14c63c55c1dd92027cc1ce07))
* селектор e2e перевода и launch-editor 2.14.2 ([1fc50c9](https://github.com/IldusSiraev/HarmoFin/commit/1fc50c909de761d1c726333ca6a3d925236f4203))

## [1.2.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.1.0...v1.2.0) (2026-10-20)


### Новое

* **api:** пакетное сохранение очереди и правил пополнения ([5e0f3e2](https://github.com/IldusSiraev/HarmoFin/commit/5e0f3e2929ef42c22d8f5e87ea2d0be4676970b0))
* **api:** чтение правил пополнения бюджета ([d477114](https://github.com/IldusSiraev/HarmoFin/commit/d477114a33adf1859e6f425c185c810fc45469b0))
* **web:** диалог изменения цели текущего периода ([f11fdfe](https://github.com/IldusSiraev/HarmoFin/commit/f11fdfeebdc4021b8bd6876d9b89acac3c95effb))
* **web:** клиент и тексты правил пополнения ([22bef8f](https://github.com/IldusSiraev/HarmoFin/commit/22bef8f1bbb0d9cf2db1479ffaa9c64123dd4239))
* **web:** модель состояния редактора правил пополнения ([a121feb](https://github.com/IldusSiraev/HarmoFin/commit/a121febb15bd0e435dab3f3a5748cb217a4bfeae))
* **web:** перетаскивание в вертикальном списке на pointer events ([22c686f](https://github.com/IldusSiraev/HarmoFin/commit/22c686f3a545aa79632ee69a83a422229afdc422))
* **web:** правило в деталях конверта, цель периода отдельным диалогом ([3357d2b](https://github.com/IldusSiraev/HarmoFin/commit/3357d2bc54c000c08da921b11b69735fb7bb1a1e))
* **web:** редактор очереди и правил пополнения ([e69a1bf](https://github.com/IldusSiraev/HarmoFin/commit/e69a1bf377285f12f8f27c5efd9cd57d0de2a802))
* **web:** страница правил пополнения конвертов ([4748124](https://github.com/IldusSiraev/HarmoFin/commit/4748124461530d6151a596110b80bdc68bb6f596))
* страница правил пополнения конвертов ([8af040f](https://github.com/IldusSiraev/HarmoFin/commit/8af040f47c4a2316a7bf56c6feb575f5b7fe025f))


### Исправления

* **web:** перенос кнопок шапки справочников на узком экране ([34ef62c](https://github.com/IldusSiraev/HarmoFin/commit/34ef62cbd2ab2530e2b740e27ffdb03206d4cb03))
* **web:** поля и подсказки страницы правил пополнения ([dd3c587](https://github.com/IldusSiraev/HarmoFin/commit/dd3c58708f76293c12c78e0e7b0264fe884abc71))
* правила пополнения — замечания финального ревью ([9ebfb2d](https://github.com/IldusSiraev/HarmoFin/commit/9ebfb2d8684dae1d84480fd56b03c82b8293bec0))

## [1.1.0](https://github.com/IldusSiraev/HarmoFin/compare/v1.0.0...v1.1.0) (2026-10-20)


### Новое

* **web:** единая панель фильтров и правки интерфейса ([f29d148](https://github.com/IldusSiraev/HarmoFin/commit/f29d148458325c1fc6074240f4a1ffe05f6fadfe))
* **web:** единая панель фильтров с выбором периода ([8f69821](https://github.com/IldusSiraev/HarmoFin/commit/8f6982151368b00ee3307f1c3eb1c454d779d27f))


### Исправления

* **web:** автозаполнение, формат дат и выравнивание сумм в планах ([7a2a9b6](https://github.com/IldusSiraev/HarmoFin/commit/7a2a9b643c6f42bc6177a9441db368987e8356b5))
* **web:** заголовок вкладки по умолчанию для страниц приложения ([01c3cd1](https://github.com/IldusSiraev/HarmoFin/commit/01c3cd1b50a3edea678b9fa8013b20907c947bcd))
* **web:** кнопка перехода в приложение на лендинге для авторизованных ([3aaa587](https://github.com/IldusSiraev/HarmoFin/commit/3aaa58732dcb9939aeee39d7f784e420f85b7ea9))
* **web:** тексты и вёрстка страниц входа и регистрации по глоссарию и Calm Fintech ([79a0da0](https://github.com/IldusSiraev/HarmoFin/commit/79a0da05bd47da9a63aad02476e69b1ad3639d55))

## 1.0.0 (2026-10-19)


### Новое

* **api:** версия и ревизия сборки в /health/live ([9f3f4a6](https://github.com/IldusSiraev/HarmoFin/commit/9f3f4a6aa653ed07ac29d48d7289175fb0c936cb))
* **ci:** деплой production по версии релиза ([4245963](https://github.com/IldusSiraev/HarmoFin/commit/424596348e1907b92c074309c7afe5e5406ec6fb))
* **infra:** smoke сверяет ревизию развёрнутого API ([e5a9764](https://github.com/IldusSiraev/HarmoFin/commit/e5a9764e59a143c0db6246e6926e47b3cab9dc90))
* **infra:** версия приложения в production-образах ([67ebc54](https://github.com/IldusSiraev/HarmoFin/commit/67ebc54ec61e857ee93cbe1ef7a44bcb925167fd))
* **infra:** резолв версии релиза в commit SHA ([46c8016](https://github.com/IldusSiraev/HarmoFin/commit/46c8016336f2ebcb87095ba8900f3923b8002f6c))
* **web:** версия приложения на странице настроек ([d02a18c](https://github.com/IldusSiraev/HarmoFin/commit/d02a18c1146f989a5bb02647f55d5a941c100dbc))
* единая система версий и выпуска релизов ([d46079e](https://github.com/IldusSiraev/HarmoFin/commit/d46079ed4e8e6a49a6238213ec1e901b5c643a02))


### Исправления

* **ci:** тегирование образов по недавним релизам и актуальные runbook отката ([c09c2da](https://github.com/IldusSiraev/HarmoFin/commit/c09c2dae32563cca24e5e05fb0721cbe247904c4))
* **infra:** smoke валит деплой, если health не прочитан ([6aedad2](https://github.com/IldusSiraev/HarmoFin/commit/6aedad231385737af69b9c1f9e6667c2fb0051b3))

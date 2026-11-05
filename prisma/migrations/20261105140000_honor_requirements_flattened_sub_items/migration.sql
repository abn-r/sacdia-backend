-- The honor catalog import stored the roman-numeral options (i, ii, iii…) of a
-- sub-item next to the letters (a, b, c) under the same parent, so a plain
-- parent asked for every option. Where two letters had their own i, ii…,
-- the repeated labels of the second one were dropped.
--
-- For 37 requirements (checked against their text on 2026-11-05):
--   * each roman option moves under its letter, renumbered in text order;
--   * the lost options are added back from the parent's text;
--   * the letter becomes a sub-item parent ("choose 1" when its text says
--     "uno de los siguientes"; otherwise all of them);
--   * the parent becomes "choose N" when its text says "N de las siguientes".
--
-- Left out (their text is corrupted: other requirements are merged into it):
-- Aves 10 (530), Deportes Adaptados 9 (1649), Memorizar la Biblia 3 (3318),
-- Mensajera de Dios 2 (3323).
--
-- Rows are found by natural key (see below), not by id. Progress is kept: rows only change parent, and nobody has progress on the
-- moved options. Re-running is safe: updates set fixed values and inserts
-- skip options that already exist.

-- Requirement ids differ between databases (the import inserted sub-items
-- in a different order in each Neon branch), so rows are found by their
-- natural key as it was before this migration: honor, parent requirement
-- number, label and, where given, the exact text. The migration aborts if
-- any row is missing or ambiguous.
DROP TABLE IF EXISTS _idmap;
CREATE TEMP TABLE _idmap AS
SELECT k.dev_id, r.requirement_id AS real_id
FROM (VALUES
    (164, 444, NULL, '11', '0751a4663d8a1181e9b26496d935f46c'),
    (305, 368, NULL, '11', '036416c22470b91892c3fd875ae2014f'),
    (593, 145, NULL, '7', 'ab8e0fc49e5592eafc8cae9f3cbb77c7'),
    (2140, 394, NULL, '3', 'e44e272a259fff4bcaf2d3a63dbcc1d5'),
    (2893, 521, NULL, '1', '6f1b55cb52874b60ad7086fbb528aa07'),
    (2906, 522, NULL, '9', 'aa14f0a62354562a2e1aaa8906a43a65'),
    (3294, 411, NULL, '6', '6a21614aaf012cf17dc689e1d2b5b8cc'),
    (3385, 414, NULL, '11', '4aaee2f8bbf2b91f46c2517c674f5820'),
    (4581, 603, NULL, '5', '9cf2a9a91f0428617e586ac63cbf48ee'),
    (5418, 442, 12, 'b', '90c9d024ef2f3cea7a3ad04029b8d272'),
    (5419, 442, 12, 'i', 'ddf1c294e8af747ec8cabbc386c8411c'),
    (5420, 442, 12, 'ii', 'c2197e89f9d90647e536c73792c60f20'),
    (5421, 442, 12, 'iii', '05112fd73942fdace7151fdec424b391'),
    (5422, 442, 12, 'iv', 'c77c392518c0c6afd01dc5de64ce0b71'),
    (5423, 442, 12, 'v', '525d2d14784cc1b310c2c8c1a472872e'),
    (5524, 444, 11, 'a', 'f8f047cc7a4a0caca0500e170659d44a'),
    (5525, 444, 11, 'i', 'a7a382d394c79ac2ae7feb83a7a36a01'),
    (5526, 444, 11, 'ii', '15b130e9df340aba34b6a66b1ff0eda0'),
    (5527, 444, 11, 'iii', '6ebf0cdd49a79fd05a8d3179a9a30637'),
    (5528, 444, 11, 'iv', '8e9509659acc341dcaf4939ab79e979b'),
    (5615, 368, 11, 'a', '912a9758ee5da8654ba2bdcf8b0d2aeb'),
    (5616, 368, 11, 'i', '5297da22ba83c07811bcc10fd09f7bb3'),
    (5617, 368, 11, 'ii', '2ef161c79139217fbf6a045513a47e78'),
    (5618, 368, 11, 'iii', '396b7fa4f8617b1e69cd8015e03df29f'),
    (5619, 368, 11, 'iv', 'd48f11347572f26a6d46bdb0bf84b58b'),
    (5620, 368, 11, 'b', '760265014d66e44b2c26917567a12a14'),
    (5621, 368, 11, 'v', 'e7eec3ecf105b1c65f5e6e898fae5489'),
    (5622, 368, 11, 'vi', '41a1166337c904d9358956d4bcae342d'),
    (5623, 368, 11, 'vii', '7505825347a8188e7c9d82b3fb9dc75c'),
    (5646, 369, 4, 'b', '400099ea04d832abad5721a660673ba6'),
    (5647, 369, 4, 'i', '7b0df88a60e00a5c6adba2b77613e6c7'),
    (5648, 369, 4, 'ii', 'dbbde3f5e93b84aed4c95f2c17e93936'),
    (5649, 369, 4, 'iii', '26fc2f0912acba20d88fb97b64cbc30b'),
    (5666, 370, 3, 'c', '5922b5e627ff1341a3eabdf7fcb6ccac'),
    (5667, 370, 3, 'i', '8c62b48aa270f5635625e47794c722b8'),
    (5668, 370, 3, 'ii', '1a6c19539d81ce543ed6658511869251'),
    (5669, 370, 3, 'iii', 'dc8c32bb29ccea6b3d3bcb18cd889fbd'),
    (5670, 370, 3, 'iv', '4074c0291ad158e969eaf27f8974c526'),
    (5770, 461, 4, 'b', '6722a43b86a0f912352c2af0785eefc4'),
    (5771, 461, 4, 'i', '92b29269d626a4e9a1f8efb2e2348eeb'),
    (5772, 461, 4, 'ii', '954eb19b9a484b991a1a65710a12092a'),
    (5773, 461, 4, 'iii', '98d22d43cfe5bc174c169ff09f57315f'),
    (5774, 461, 4, 'iv', '84c89dcc057bee5399ad2ff78e284849'),
    (5775, 461, 4, 'v', '5dc432895b3ace0a13462571d8325f3a'),
    (5776, 461, 4, 'vi', '550408bfb7c56dbee539fd8d59fd07de'),
    (5856, 145, 1, 'a', 'cc4d0c4990dcd1816a46eb4d073623f4'),
    (5857, 145, 1, 'i', 'bf7ee70cba072a7857c92f605146df77'),
    (5858, 145, 1, 'ii', 'd167b81e49d3574444b90a05c102de7c'),
    (5859, 145, 1, 'iii', '21821c28ec2a1982a919b3109238a886'),
    (5860, 145, 1, 'iv', 'f34d8bbf5c8d4e749f58aaef39ee60e6'),
    (5897, 145, 7, 'a', 'e2ab5024fe069da60a56b32069c72f6f'),
    (5898, 145, 7, 'i', 'd9870d95bccacb694118251954e82947'),
    (5899, 145, 7, 'ii', 'cbe362a4847271d71a5bd49477933120'),
    (6022, 477, 5, 'a', 'd6eb52bf8a1b2b3fe549702cc0a4d866'),
    (6023, 477, 5, 'i', 'cf59ddbce74acff2dd103615ea081dca'),
    (6024, 477, 5, 'ii', '43e7275b114ba45af10157fc206ea02f'),
    (6025, 477, 5, 'iii', '4e5a2deae8783bd15ee615b196dfb2b4'),
    (6026, 477, 5, 'iv', '196ab84f83641918e72ca69f4e9f717c'),
    (6036, 30, 2, 'a', 'e76b56b55a65dfd5feddf5a61e727505'),
    (6037, 30, 2, 'i', 'd6dc521b7098a4deb5d7b5837e3f2369'),
    (6038, 30, 2, 'ii', 'ed05242b1db94e385560ac7bc3d187b7'),
    (6151, 34, 7, 'a', '9e584f36a7ade47e7396b1f6b8e8604a'),
    (6152, 34, 7, 'i', '40029a36a6666bb7c978e703d6fc8ec7'),
    (6153, 34, 7, 'ii', '00792cf8ad9aa59ce4768a9ab6ea6a8f'),
    (6154, 34, 7, 'iii', '7e9a96105b264560bafb3c49a04f4869'),
    (6155, 34, 7, 'iv', '7ee306f665f4397ef1e4169bb5f512c0'),
    (6156, 34, 7, 'v', 'b1d6fa024d95b836385a184a75752b44'),
    (6319, 158, 5, 'a', '83209b4b1a349c492c1f19c56c130560'),
    (6320, 158, 5, 'i', 'fa08ef5c3cb9f74e211929fd5c88003b'),
    (6321, 158, 5, 'ii', '4a2de32e2bc547d29284ecd9b91bf770'),
    (6322, 158, 5, 'iii', '0b59f4a32845261cb5a1533ebfff5496'),
    (6323, 158, 5, 'iv', 'c4612e83075e9804a0650fdd908c8409'),
    (6329, 158, 5, 'g', 'ead248f2f7ae394d3aade7c9b09a34b7'),
    (6330, 158, 5, 'v', 'e5f8fe724034fd9e6de459d409bdbf90'),
    (6331, 158, 5, 'vi', '3ebc7c67d8eba5a0c0eef9a0641e8063'),
    (6338, 489, 4, 'a', '417b197b26ead2fd2c8d0f2a1384bb17'),
    (6339, 489, 4, 'i', '6199fa414dc66ae410d0758236c04b9a'),
    (6340, 489, 4, 'ii', '4d679912a85d53a54f5c88aa3ae1cbe3'),
    (6341, 489, 4, 'iii', 'b6e44255ea5af3403a30fe4f5e328266'),
    (6342, 489, 4, 'iv', '021853703106f648d094534a55a744df'),
    (6343, 489, 4, 'v', 'f708d3390e26c40a722037802cc74157'),
    (6344, 489, 4, 'vi', 'c6e15b0054d9bd0da666845872fce53b'),
    (6345, 489, 4, 'vii', '4a0021b11be6d6866f1cf94cbd1bf3b6'),
    (6346, 489, 4, 'viii', '42d05391202e8d31bf2567c612378ea9'),
    (6347, 489, 4, 'b', '3f74099d275feaf147b902d7a6417421'),
    (6348, 489, 4, 'ix', 'f1781c54f146013d61c0c3887e3fb9ec'),
    (6349, 489, 4, 'x', '1487b09ec789ef9279447bd78d8cca3c'),
    (6590, 496, 6, 'c', '57f9f38b64b64716cca44e829eb1bbf2'),
    (6591, 496, 6, 'i', 'b2dffcff628d29d4cecd0205cdd908b2'),
    (6592, 496, 6, 'ii', '1588fe86d49a76de07852eeff5b6dec7'),
    (6894, 394, 3, 'a', '811236bf04b15e572219994e8ca7a085'),
    (6895, 394, 3, 'i', '397b7fa04070ea8ddcc26685e03059dc'),
    (6896, 394, 3, 'ii', '1d9aeed2a36783f8cd12528c837a05dd'),
    (6897, 394, 3, 'iii', 'b88c3d13ae4b5dfaced30b3f00b4d829'),
    (6898, 394, 3, 'iv', '16b474bbaf07beda8df62edd6d918ae9'),
    (6899, 394, 3, 'v', 'a23d754b107acf4a5fa7b4ff8cac3679'),
    (6900, 394, 3, 'vi', 'ca956e0124992ebb9568d702ff735e74'),
    (6901, 394, 3, 'vii', '9f296ea24c0d2eeb8e59ee7849a77320'),
    (6902, 394, 3, 'b', 'ddb776ee70add03adee5f8683c2a201e'),
    (6903, 394, 3, 'viii', '507e44615f8c87020d9cea483120f943'),
    (6904, 394, 3, 'c', '6552f7e598013734015b1f08a3862da7'),
    (6905, 394, 3, 'ix', '6d45faa21fa31c8965819d50b115aeaf'),
    (6906, 394, 3, 'x', '3a7f83fa7b5263cd699c37c3f05b0154'),
    (7136, 511, 2, 'a', '92c5a10fe08915b98e7cf3d514a7b06a'),
    (7137, 511, 2, 'i', '31383f4ec7f083289cd043700b24bf0c'),
    (7138, 511, 2, 'ii', '5b4414cdc0c3b6f62532815e4e8e3ab2'),
    (7139, 511, 2, 'iii', 'bafb490ffb69caa83de69036942846d1'),
    (7404, 178, 7, 'a', '6bb17b60650301c035efc39132299e2f'),
    (7405, 178, 7, 'i', 'e607bcdbdb60b4a25ce96cae03ff6150'),
    (7406, 178, 7, 'ii', '64d8547f5498a0ae7d1d6f90f27b270c'),
    (7407, 178, 7, 'iii', '644da63888380509289c58cb1af951d2'),
    (7408, 178, 7, 'iv', 'e07c15a1dbc73d59f7baa6908e29e92f'),
    (7409, 178, 7, 'v', 'efa1b184fd3bb792b9ae695eb411985b'),
    (7410, 178, 7, 'vi', 'ce0d1b5c2c32176584d425b8138d6ec0'),
    (7412, 178, 8, 'a', 'b42a7138a30df19fd8204431322dced0'),
    (7413, 178, 8, 'i', '95f8c2da33b8930f8d6fee0d524c0817'),
    (7414, 178, 8, 'ii', '06ef40d2618a8c2000077e83ddc454b4'),
    (7415, 178, 8, 'b', '52ac4f5ea31580eacf52b7b7863aa83d'),
    (7416, 178, 8, 'iii', '52e37f84a4c4b0842df92f5469ca08af'),
    (7417, 178, 8, 'iv', 'a866e654e8ce096795c284e6e7684a60'),
    (7418, 178, 11, 'a', 'bcee81cd4f804c69ac684f525adf542b'),
    (7419, 178, 11, 'i', 'e9222fbc2eb15a24b44691c6b6f5492c'),
    (7420, 178, 11, 'ii', 'fc95beb556180f7a23aaf8e046dfdfec'),
    (7487, 180, 4, 'a', 'b2af65cd81e97703ba194fb20c1f8db5'),
    (7488, 180, 4, 'i', '4d43ebc87ba3f82bb8aab51bf1b0cd46'),
    (7489, 180, 4, 'ii', '06171f606f5c2e480011f7356ee3f368'),
    (7490, 180, 4, 'iii', '8656173b26c2b32a15fd9605a11968bc'),
    (7491, 180, 4, 'iv', '30d7f0eb7bf821bc54486b86acba3804'),
    (7492, 180, 4, 'v', '66aefbc9bd0f15cdd0359707fa7053d5'),
    (7493, 180, 4, 'vi', 'caead4e8aeaedb14ced4550034ab8223'),
    (7494, 180, 4, 'vii', 'db1328ec75d5a3cdb447de8e129dce97'),
    (7495, 180, 4, 'viii', '225b75361f732faf8c1098cc3f6d702e'),
    (7496, 180, 4, 'ix', '6ddc1839e576294bd3c54e9e9e67658f'),
    (7497, 180, 4, 'x', 'b484fa6da1d87a417dd5a98ce26b9071'),
    (7510, 521, 1, 'a', '8f7ce3812eae78d4ca686c6fd09c4578'),
    (7511, 521, 1, 'i', 'b922eabe3e045adace2fb4312c58abc8'),
    (7512, 521, 1, 'ii', 'ddbabefb850b42a50aafeeac49ed468f'),
    (7513, 521, 1, 'iii', 'eb8002f943b29add231c0a56e6cb13c3'),
    (7522, 522, 9, 'a', '85bba3ec480b5e1689c540d373ea091a'),
    (7523, 522, 9, 'i', '9d97dffc7a4bb31f6bafdfe5e15491cf'),
    (7524, 522, 9, 'ii', '4091cad8d3f81846302d753fb8bcae22'),
    (7525, 522, 9, 'iii', 'e2b90d068199b13f2a45af1ffc4dd0ac'),
    (7526, 522, 9, 'iv', 'df2290fb3eba4e439f75b266470961f4'),
    (7527, 522, 9, 'v', '5a7e07616a666148e6eaa1661c89b273'),
    (7528, 522, 9, 'vi', '3c7e958e99427f92afaae8f3145855e1'),
    (7796, 532, 5, 'a', '742283e53437d2880fcb3d7da8632dbc'),
    (7797, 532, 5, 'i', '0e016d893aa24bbfe090138c7f9070e3'),
    (7798, 532, 5, 'ii', '0e24888a36adb8076098a42bf2adf69f'),
    (7799, 532, 5, 'iii', '820897abcdbca1e49ffb8c6aff577ea0'),
    (7800, 532, 5, 'iv', '06ce4f5d013269e27027ada527473a64'),
    (7801, 532, 5, 'v', 'aa841edb779b054fd00b8939b6328b00'),
    (7802, 532, 5, 'vi', '98292e69eabb6f9a8798f534c32c0974'),
    (7803, 532, 5, 'vii', 'b4135e9bd2eb76ee18cff0b846db3b5c'),
    (7804, 532, 5, 'viii', '1c3fec0d6c3fd79f0141908ae4e317c6'),
    (7831, 411, 6, 'b', 'a37165411a27089cec8628f39f09ce03'),
    (7832, 411, 6, 'i', '93d5cce20ed9cc3c82a6219e2bfce589'),
    (7833, 411, 6, 'ii', 'cde8c8801a0a0954479cbdd9c9311c47'),
    (7834, 411, 6, 'iii', 'dcb9922949cc37c815b0e4d60c7673d2'),
    (7835, 411, 6, 'iv', '6107fff2dbbd02ea1bf5ce32cc435f55'),
    (7836, 411, 6, 'v', 'ffe0daaa64632244fea645aa65c4f7aa'),
    (7837, 411, 6, 'vi', '5324a29ff1290364680320dfb8a37e90'),
    (7838, 411, 6, 'vii', '3fd315d42c51abb5277a15597d1f102c'),
    (7839, 411, 6, 'viii', '17eee34f2b7c9047b252bcd923d3c15d'),
    (7858, 413, 1, 'g', 'aa78c197fd4ff95361c185b96eb3e8af'),
    (7859, 413, 1, 'i', '44db77a9d83973a83b8a995a8fa84c6e'),
    (7860, 413, 1, 'ii', '69e77fb868f00c3865251e2e85e2e073'),
    (7861, 413, 1, 'iii', 'a9026c02f72df985f4fd5f3b59487e70'),
    (7862, 413, 1, 'iv', '4f58900f7af151b2b5ced6914c8cbc72'),
    (7863, 413, 1, 'v', 'e97f36eb1d1dbee4bd050ac55cca8861'),
    (7864, 413, 1, 'vi', '3b2a31340aea6e5aa910d1fe97a086c4'),
    (7865, 413, 1, 'vii', 'c6ba77091a957266946b43eae5a13cbb'),
    (7866, 413, 1, 'viii', 'e291171aa3b966817aa069fe401bda69'),
    (7867, 413, 1, 'ix', '90d78791500e71e7ccedbec499f7c965'),
    (7868, 413, 1, 'x', '8dcae6ebc1161b95bee0e3a9c3ee78ce'),
    (7928, 414, 11, 'a', '0c56128363d329fb8d4cf7c1a75188d1'),
    (7929, 414, 11, 'i', '9d8533db93b52f9f624c938ae473d61c'),
    (7930, 414, 11, 'ii', '850dc97c292516382a8215a3f6d1212a'),
    (7931, 414, 11, 'iii', 'a42cd2f3dfda48064f484e0a0caf7b90'),
    (7932, 414, 11, 'iv', '4660f203376743b861397ec4ce5ccd62'),
    (7933, 414, 11, 'b', '319c8f90c3023162f3d6a01ec1bd8357'),
    (7934, 414, 11, 'v', '6bfff3286f3e94f97b06f4c151692fbc'),
    (7935, 414, 11, 'vi', '23da341a441df6169012dc2dded08f9e'),
    (7936, 414, 11, 'vii', '82cb1021b7eb15babf2dd8a6389a5e0f'),
    (7937, 414, 11, 'viii', 'e7e4470e5a45a1abc4cfd9e8ed92fac6'),
    (7977, 541, 6, 'a', '11d2fe13399a97a10ae2dde2b14089fa'),
    (7978, 541, 6, 'i', '1a46e53df04c968c7cebf1e16ba98b6b'),
    (7979, 541, 6, 'ii', 'd5da25e7f977f63a64b2016a8a0b23d1'),
    (7980, 541, 6, 'iii', '4cf77542ac29cea7e0f5a180668fbff4'),
    (7981, 541, 6, 'iv', '593e8bc8f5348a4f629001e265c18a34'),
    (8028, 92, 5, 'b', 'c0de9e4e2c7ba99eac611f8e5d2d4b98'),
    (8029, 92, 5, 'i', 'e0050859c3e23a932516a593e78a8196'),
    (8030, 92, 5, 'ii', '24dc3c3c4f4f4e12d7eeb071a8c6338a'),
    (8031, 92, 5, 'iii', '109bcd460dbc0895a73019c9195c3f64'),
    (8032, 92, 5, 'iv', 'c8cbc3e8b9fc35a3f6ce11202fe3319e'),
    (8033, 92, 5, 'v', 'b99f8dd9bd029a8f1abfc9c1c9271c1c'),
    (8151, 97, 13, 'b', 'cc64f72d11521b5c17efbaedee8418d4'),
    (8152, 97, 13, 'i', '1356e2a7fe36c6620010462bcc9107c8'),
    (8153, 97, 13, 'ii', 'a7781324a97653cee18ca83eb307c2fd'),
    (8154, 97, 13, 'iii', 'e865d8b5eb92567872807b0b69339312'),
    (8364, 425, 5, 'c', '99188e01dcd7b31c335be61dfba31cf5'),
    (8365, 425, 5, 'i', '24ea1c1f947f71710ecc78b6760c092e'),
    (8366, 425, 5, 'ii', '645976a8c22d63887d71a85e4c788460'),
    (8367, 425, 5, 'iii', 'a03f36d2ff839019fbad1056c07ab69c'),
    (8368, 425, 5, 'iv', 'c96b1a9c0bb94fe29faeb805ea2b0e11'),
    (8369, 425, 5, 'v', '268ed269c1a9338ef139f69640a3f14d'),
    (8370, 425, 5, 'vi', 'bb699a509457f6a3606ef486bdf4b653'),
    (8371, 425, 5, 'vii', '9366e918e888e4de66b2fc5223e2a19e'),
    (8393, 595, 4, 'e', 'ffbb3a12381f8cf4f74319c7e1f8ce48'),
    (8394, 595, 4, 'i', 'c2befae743efd6c42c4ac97bec1505f8'),
    (8395, 595, 4, 'ii', 'caf068529ae8f93e390bb43b804357f5'),
    (8396, 595, 4, 'iii', '3276efd340754e55b6f1ec08e5247492'),
    (8470, 201, 5, 'a', 'c908e4c9625b5b06dae34e272e170e90'),
    (8471, 201, 5, 'i', '2400e5ccdcd221d5d3b2a93e3c22a2e0'),
    (8472, 201, 5, 'ii', '99e289ffe60f9b688b4a1859ceacc89e'),
    (8473, 201, 5, 'iii', '87fcf31bf74db78eb8b1b87a6ea0dd3d'),
    (8474, 201, 5, 'iv', '5bfba897229403da8e033a173dbbcbeb'),
    (8475, 201, 5, 'v', 'ed4ac44ae05636a578e1df5e82d316dd'),
    (8476, 201, 5, 'vi', 'd44be0e23e82c4b446aa52e86ac62c87'),
    (8569, 108, 3, 'c', 'da657a32ec059dee1891e9c9cba9f7d2'),
    (8570, 108, 3, 'i', 'ebcbb616a81ec3a043d426f1ab88d07a'),
    (8571, 108, 3, 'ii', '5afd4c9e0c98859d90884a9f9807b298'),
    (8572, 108, 3, 'iii', '7d55f7a09f150ed68cb68f879d82ff6b'),
    (8573, 108, 3, 'iv', '3238698766d480236136039399dcff45'),
    (8574, 108, 3, 'v', '5626ab83d94e975dbbb1a7418d5fae0c'),
    (8657, 603, 5, 'b', '18e1f868811ec7d452eb813f6aef6973'),
    (8658, 603, 5, 'i', '011c49486241e44a380387eace936c35'),
    (8659, 603, 5, 'ii', '6910c762fbf47f92b5699cbff1e2622a'),
    (8660, 603, 5, 'iii', '57e3fc5bbde320c8cf0d614a63646c77'),
    (8661, 603, 5, 'iv', 'b1bdd9b2fa1df409d03a941cf66e9aee'),
    (8663, 603, 5, 'd', 'd104e37a08ba4637699f70f9570bfa97'),
    (8664, 603, 5, 'v', 'fffc8954c455015843d4046c207f74a1'),
    (8953, 326, 3, 'a', '0f56c3f76f5cf8c5e9ea617bce31f6f1'),
    (8954, 326, 3, 'i', '3b0a2c5a069418fcf563d04714944a4a'),
    (8955, 326, 3, 'ii', 'aae13f5578b9e8323ff54d7069262d88'),
    (8956, 326, 3, 'iii', 'fa35ca61bbcd619993aad3fa4b560711'),
    (8957, 326, 3, 'iv', '0b01abca537354d8408bea6fc1d68189'),
    (8958, 326, 3, 'b', '9ff7ce06289480e3fa76c70c4a051e27'),
    (8959, 326, 3, 'v', '09ef61e3783e9e4b28fa47188a9cf3b2'),
    (9041, 328, 1, 'b', '78749f438f836b820dd7ca4910a95950'),
    (9042, 328, 1, 'i', 'd025e3b58a19d1fb48a30b1084bfec22'),
    (9043, 328, 1, 'ii', 'fce1c06269225281fae9720cbb88d12b'),
    (9044, 328, 1, 'iii', '5e5bbf6c42193ee4a87b2b49b62ed43a'),
    (9046, 328, 1, 'd', 'd2702fb7436d4d0b450d63c8e9d4ef47'),
    (9047, 328, 1, 'iv', '20672be76ac34b922f3d8804eac6e731'),
    (9048, 328, 1, 'v', 'a1593f38e8fda4c282d836184f42e93c'),
    (9153, 138, 5, 'a', '43d6f75bb75f9e38309f29be6c9688de'),
    (9154, 138, 5, 'i', '6a6c040caf81972f5c70765cf6ab56e5'),
    (9155, 138, 5, 'ii', '0ae7180e89243c412591f18416301869'),
    (9156, 138, 5, 'iii', '6625496e8e2ae3126fb82e4672dc8276'),
    (9157, 138, 5, 'b', '06dc2b29588e150dbea0071285c27df8'),
    (9158, 138, 5, 'iv', '0f303959e4b0b0c4f634a9a554bec294'),
    (9159, 138, 5, 'v', '2d4ddf7f97b77828770d3f09e96f5e33'),
    (9160, 138, 5, 'vi', '4a124b7e9e1b5eb9a61d83643173464a'),
    (9161, 138, 5, 'vii', '5b2a3ffb366c8f49a0631dcca841754c'),
    (9162, 138, 5, 'viii', '493d567aedc35770cf86ce8384a8fa03')
) AS k(dev_id, honor_id, parent_number, display_label, text_md5)
LEFT JOIN honor_requirements r
  ON r.honor_id = k.honor_id
 AND r.display_label IS NOT DISTINCT FROM k.display_label
 AND (k.text_md5 IS NULL OR md5(r.requirement_text) = k.text_md5::text)
 AND ((k.parent_number IS NULL AND r.parent_id IS NULL)
      OR EXISTS (SELECT 1 FROM honor_requirements p
                 WHERE p.requirement_id = r.parent_id
                   AND p.requirement_number = k.parent_number::int));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _idmap WHERE real_id IS NULL)
     OR (SELECT count(*) FROM _idmap) <> (SELECT count(DISTINCT dev_id) FROM _idmap) THEN
    RAISE EXCEPTION 'honor requirement id map: missing or ambiguous rows';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rid(integer) RETURNS integer
LANGUAGE sql STABLE AS $f$ SELECT real_id FROM pg_temp._idmap WHERE dev_id = $1 $f$;

-- Free the requirement numbers first: (honor_id, requirement_number) is
-- unique and the new numbers reuse the old range.
UPDATE honor_requirements SET requirement_number = -requirement_id
WHERE requirement_id IN (pg_temp.rid(5419), pg_temp.rid(5420), pg_temp.rid(5421), pg_temp.rid(5422), pg_temp.rid(5423), pg_temp.rid(5525), pg_temp.rid(5526), pg_temp.rid(5527), pg_temp.rid(5528), pg_temp.rid(5616), pg_temp.rid(5617), pg_temp.rid(5618), pg_temp.rid(5619), pg_temp.rid(5621), pg_temp.rid(5622), pg_temp.rid(5623), pg_temp.rid(5647), pg_temp.rid(5648), pg_temp.rid(5649), pg_temp.rid(5667), pg_temp.rid(5668), pg_temp.rid(5669), pg_temp.rid(5670), pg_temp.rid(5771), pg_temp.rid(5772), pg_temp.rid(5773), pg_temp.rid(5774), pg_temp.rid(5775), pg_temp.rid(5776), pg_temp.rid(5898), pg_temp.rid(5899), pg_temp.rid(5857), pg_temp.rid(5858), pg_temp.rid(5859), pg_temp.rid(5860), pg_temp.rid(6023), pg_temp.rid(6024), pg_temp.rid(6025), pg_temp.rid(6026), pg_temp.rid(6037), pg_temp.rid(6038), pg_temp.rid(6152), pg_temp.rid(6153), pg_temp.rid(6154), pg_temp.rid(6155), pg_temp.rid(6156), pg_temp.rid(6320), pg_temp.rid(6321), pg_temp.rid(6322), pg_temp.rid(6323), pg_temp.rid(6330), pg_temp.rid(6331), pg_temp.rid(6339), pg_temp.rid(6340), pg_temp.rid(6341), pg_temp.rid(6342), pg_temp.rid(6343), pg_temp.rid(6344), pg_temp.rid(6345), pg_temp.rid(6346), pg_temp.rid(6348), pg_temp.rid(6349), pg_temp.rid(6591), pg_temp.rid(6592), pg_temp.rid(6895), pg_temp.rid(6896), pg_temp.rid(6897), pg_temp.rid(6898), pg_temp.rid(6899), pg_temp.rid(6900), pg_temp.rid(6901), pg_temp.rid(6903), pg_temp.rid(6905), pg_temp.rid(6906), pg_temp.rid(7137), pg_temp.rid(7138), pg_temp.rid(7139), pg_temp.rid(7419), pg_temp.rid(7420), pg_temp.rid(7413), pg_temp.rid(7414), pg_temp.rid(7416), pg_temp.rid(7417), pg_temp.rid(7405), pg_temp.rid(7406), pg_temp.rid(7407), pg_temp.rid(7408), pg_temp.rid(7409), pg_temp.rid(7410), pg_temp.rid(7488), pg_temp.rid(7489), pg_temp.rid(7490), pg_temp.rid(7491), pg_temp.rid(7492), pg_temp.rid(7493), pg_temp.rid(7494), pg_temp.rid(7495), pg_temp.rid(7496), pg_temp.rid(7497), pg_temp.rid(7511), pg_temp.rid(7512), pg_temp.rid(7513), pg_temp.rid(7523), pg_temp.rid(7524), pg_temp.rid(7525), pg_temp.rid(7526), pg_temp.rid(7527), pg_temp.rid(7528), pg_temp.rid(7797), pg_temp.rid(7798), pg_temp.rid(7799), pg_temp.rid(7800), pg_temp.rid(7801), pg_temp.rid(7802), pg_temp.rid(7803), pg_temp.rid(7804), pg_temp.rid(7832), pg_temp.rid(7833), pg_temp.rid(7834), pg_temp.rid(7835), pg_temp.rid(7836), pg_temp.rid(7837), pg_temp.rid(7838), pg_temp.rid(7839), pg_temp.rid(7859), pg_temp.rid(7860), pg_temp.rid(7861), pg_temp.rid(7862), pg_temp.rid(7863), pg_temp.rid(7864), pg_temp.rid(7865), pg_temp.rid(7866), pg_temp.rid(7867), pg_temp.rid(7868), pg_temp.rid(7929), pg_temp.rid(7930), pg_temp.rid(7931), pg_temp.rid(7932), pg_temp.rid(7934), pg_temp.rid(7935), pg_temp.rid(7936), pg_temp.rid(7937), pg_temp.rid(7978), pg_temp.rid(7979), pg_temp.rid(7980), pg_temp.rid(7981), pg_temp.rid(8029), pg_temp.rid(8030), pg_temp.rid(8031), pg_temp.rid(8032), pg_temp.rid(8033), pg_temp.rid(8152), pg_temp.rid(8153), pg_temp.rid(8154), pg_temp.rid(8365), pg_temp.rid(8366), pg_temp.rid(8367), pg_temp.rid(8368), pg_temp.rid(8369), pg_temp.rid(8370), pg_temp.rid(8371), pg_temp.rid(8394), pg_temp.rid(8395), pg_temp.rid(8396), pg_temp.rid(8471), pg_temp.rid(8472), pg_temp.rid(8473), pg_temp.rid(8474), pg_temp.rid(8475), pg_temp.rid(8476), pg_temp.rid(8570), pg_temp.rid(8571), pg_temp.rid(8572), pg_temp.rid(8573), pg_temp.rid(8574), pg_temp.rid(8658), pg_temp.rid(8659), pg_temp.rid(8660), pg_temp.rid(8661), pg_temp.rid(8664), pg_temp.rid(8954), pg_temp.rid(8955), pg_temp.rid(8956), pg_temp.rid(8957), pg_temp.rid(8959), pg_temp.rid(9042), pg_temp.rid(9043), pg_temp.rid(9044), pg_temp.rid(9047), pg_temp.rid(9048), pg_temp.rid(9154), pg_temp.rid(9155), pg_temp.rid(9156), pg_temp.rid(9158), pg_temp.rid(9159), pg_temp.rid(9160), pg_temp.rid(9161), pg_temp.rid(9162));

-- Acuarios · requisito 12
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5418);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5418), requirement_number = 12201, modified_at = now() WHERE requirement_id = pg_temp.rid(5419);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5418), requirement_number = 12202, modified_at = now() WHERE requirement_id = pg_temp.rid(5420);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5418), requirement_number = 12203, modified_at = now() WHERE requirement_id = pg_temp.rid(5421);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5418), requirement_number = 12204, modified_at = now() WHERE requirement_id = pg_temp.rid(5422);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5418), requirement_number = 12205, modified_at = now() WHERE requirement_id = pg_temp.rid(5423);

-- Anfibios · requisito 11
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(164);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5524);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5524), requirement_number = 11101, modified_at = now() WHERE requirement_id = pg_temp.rid(5525);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5524), requirement_number = 11102, modified_at = now() WHERE requirement_id = pg_temp.rid(5526);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5524), requirement_number = 11103, modified_at = now() WHERE requirement_id = pg_temp.rid(5527);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5524), requirement_number = 11104, modified_at = now() WHERE requirement_id = pg_temp.rid(5528);

-- Arqueología bíblica · requisito 11
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(305);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5615);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5615), requirement_number = 11101, modified_at = now() WHERE requirement_id = pg_temp.rid(5616);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5615), requirement_number = 11102, modified_at = now() WHERE requirement_id = pg_temp.rid(5617);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5615), requirement_number = 11103, modified_at = now() WHERE requirement_id = pg_temp.rid(5618);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5615), requirement_number = 11104, modified_at = now() WHERE requirement_id = pg_temp.rid(5619);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5620);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, pg_temp.rid(5620), 11201, 'i', 'Herramientas de recolección' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 368 AND requirement_number = 11201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, pg_temp.rid(5620), 11202, 'ii', 'Colocación de la rejilla/zona de excavación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 368 AND requirement_number = 11202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, pg_temp.rid(5620), 11203, 'iii', 'Excavación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 368 AND requirement_number = 11203);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, pg_temp.rid(5620), 11204, 'iv', 'Identificación de artefactos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 368 AND requirement_number = 11204);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5620), requirement_number = 11205, modified_at = now() WHERE requirement_id = pg_temp.rid(5621);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5620), requirement_number = 11206, modified_at = now() WHERE requirement_id = pg_temp.rid(5622);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5620), requirement_number = 11207, modified_at = now() WHERE requirement_id = pg_temp.rid(5623);

-- Arte Cristiano de Predicar · requisito 4
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5646);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5646), requirement_number = 4201, modified_at = now() WHERE requirement_id = pg_temp.rid(5647);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5646), requirement_number = 4202, modified_at = now() WHERE requirement_id = pg_temp.rid(5648);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5646), requirement_number = 4203, modified_at = now() WHERE requirement_id = pg_temp.rid(5649);

-- Arte Cristiano de Predicar - Avanzado · requisito 3
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5666);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5666), requirement_number = 3301, modified_at = now() WHERE requirement_id = pg_temp.rid(5667);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5666), requirement_number = 3302, modified_at = now() WHERE requirement_id = pg_temp.rid(5668);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5666), requirement_number = 3303, modified_at = now() WHERE requirement_id = pg_temp.rid(5669);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5666), requirement_number = 3304, modified_at = now() WHERE requirement_id = pg_temp.rid(5670);

-- Aves - Avanzado · requisito 4
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5770);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4201, modified_at = now() WHERE requirement_id = pg_temp.rid(5771);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4202, modified_at = now() WHERE requirement_id = pg_temp.rid(5772);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4203, modified_at = now() WHERE requirement_id = pg_temp.rid(5773);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4204, modified_at = now() WHERE requirement_id = pg_temp.rid(5774);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4205, modified_at = now() WHERE requirement_id = pg_temp.rid(5775);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5770), requirement_number = 4206, modified_at = now() WHERE requirement_id = pg_temp.rid(5776);

-- Aviadores · requisito 7
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(593);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5897);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5897), requirement_number = 7101, modified_at = now() WHERE requirement_id = pg_temp.rid(5898);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5897), requirement_number = 7102, modified_at = now() WHERE requirement_id = pg_temp.rid(5899);

-- Aviadores · requisito 1
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5856);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5856), requirement_number = 1101, modified_at = now() WHERE requirement_id = pg_temp.rid(5857);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5856), requirement_number = 1102, modified_at = now() WHERE requirement_id = pg_temp.rid(5858);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5856), requirement_number = 1103, modified_at = now() WHERE requirement_id = pg_temp.rid(5859);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5856), requirement_number = 1104, modified_at = now() WHERE requirement_id = pg_temp.rid(5860);

-- Camuflaje Animal - Avanzado · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6022);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6022), requirement_number = 5101, modified_at = now() WHERE requirement_id = pg_temp.rid(6023);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6022), requirement_number = 5102, modified_at = now() WHERE requirement_id = pg_temp.rid(6024);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6022), requirement_number = 5103, modified_at = now() WHERE requirement_id = pg_temp.rid(6025);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6022), requirement_number = 5104, modified_at = now() WHERE requirement_id = pg_temp.rid(6026);

-- Canotaje · requisito 2
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6036);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6036), requirement_number = 2101, modified_at = now() WHERE requirement_id = pg_temp.rid(6037);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6036), requirement_number = 2102, modified_at = now() WHERE requirement_id = pg_temp.rid(6038);

-- Ciclismo - Avanzado · requisito 7
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6151);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6151), requirement_number = 7101, modified_at = now() WHERE requirement_id = pg_temp.rid(6152);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6151), requirement_number = 7102, modified_at = now() WHERE requirement_id = pg_temp.rid(6153);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6151), requirement_number = 7103, modified_at = now() WHERE requirement_id = pg_temp.rid(6154);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6151), requirement_number = 7104, modified_at = now() WHERE requirement_id = pg_temp.rid(6155);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6151), requirement_number = 7105, modified_at = now() WHERE requirement_id = pg_temp.rid(6156);

-- Computadoras - Avanzado · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6319);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6319), requirement_number = 5101, modified_at = now() WHERE requirement_id = pg_temp.rid(6320);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6319), requirement_number = 5102, modified_at = now() WHERE requirement_id = pg_temp.rid(6321);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6319), requirement_number = 5103, modified_at = now() WHERE requirement_id = pg_temp.rid(6322);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6319), requirement_number = 5104, modified_at = now() WHERE requirement_id = pg_temp.rid(6323);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6329);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, pg_temp.rid(6329), 5701, 'i', 'Poner un marco o hacer borroso los bordes de una fotografía' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 158 AND requirement_number = 5701);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, pg_temp.rid(6329), 5702, 'ii', 'Cambiar una fotografía digital de color a una de tono sepia o de blanco y negro' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 158 AND requirement_number = 5702);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, pg_temp.rid(6329), 5703, 'iii', 'Grabar una fotografía digital como una diferente clase de archivo al del original' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 158 AND requirement_number = 5703);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, pg_temp.rid(6329), 5704, 'iv', 'Combinar elementos de 2 fotografías digitales para crear una tercera imagen.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 158 AND requirement_number = 5704);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6329), requirement_number = 5705, modified_at = now() WHERE requirement_id = pg_temp.rid(6330);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6329), requirement_number = 5706, modified_at = now() WHERE requirement_id = pg_temp.rid(6331);

-- Conservación Ambiental · requisito 4
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6338);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4101, modified_at = now() WHERE requirement_id = pg_temp.rid(6339);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4102, modified_at = now() WHERE requirement_id = pg_temp.rid(6340);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4103, modified_at = now() WHERE requirement_id = pg_temp.rid(6341);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4104, modified_at = now() WHERE requirement_id = pg_temp.rid(6342);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4105, modified_at = now() WHERE requirement_id = pg_temp.rid(6343);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4106, modified_at = now() WHERE requirement_id = pg_temp.rid(6344);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4107, modified_at = now() WHERE requirement_id = pg_temp.rid(6345);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6338), requirement_number = 4108, modified_at = now() WHERE requirement_id = pg_temp.rid(6346);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6347);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4201, 'i', 'Las grandes masas presentes de algas color azul-verduzco (color verde oscuro)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4202, 'ii', 'Bancos de arena raspados por el alto nivel de agua durante las tormentas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4203, 'iii', 'Olores putrefactos en el agua' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4203);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4204, 'iv', 'Espuma tipo detergente presente' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4204);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4205, 'v', 'Basura entre el lodo y los bancos de arena a lo largo del arroyo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4205);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4206, 'vi', 'El agua cargada de limo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4206);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4207, 'vii', 'No hay insectos acuáticos o peces presentes' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4207);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4208, 'viii', 'Presencia de aguas residuales sin tratar' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4208);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6347), requirement_number = 4209, modified_at = now() WHERE requirement_id = pg_temp.rid(6348);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6347), requirement_number = 4210, modified_at = now() WHERE requirement_id = pg_temp.rid(6349);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, pg_temp.rid(6347), 4211, 'xi', 'Tiendas o pequeñas fábricas vertiendo sus desechos dentro del arroyo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 489 AND requirement_number = 4211);

-- Dinosaurios · requisito 6
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6590);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6590), requirement_number = 6301, modified_at = now() WHERE requirement_id = pg_temp.rid(6591);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6590), requirement_number = 6302, modified_at = now() WHERE requirement_id = pg_temp.rid(6592);

-- Evangelismo Personal · requisito 3
UPDATE honor_requirements SET is_choice_group = true, choice_min = 2, modified_at = now() WHERE requirement_id = pg_temp.rid(2140);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(6894);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3101, modified_at = now() WHERE requirement_id = pg_temp.rid(6895);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3102, modified_at = now() WHERE requirement_id = pg_temp.rid(6896);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3103, modified_at = now() WHERE requirement_id = pg_temp.rid(6897);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3104, modified_at = now() WHERE requirement_id = pg_temp.rid(6898);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3105, modified_at = now() WHERE requirement_id = pg_temp.rid(6899);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3106, modified_at = now() WHERE requirement_id = pg_temp.rid(6900);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6894), requirement_number = 3107, modified_at = now() WHERE requirement_id = pg_temp.rid(6901);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(6902);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3201, 'i', 'Proyecto de embellecimiento comunitario, como la jardinería o la mejoría de un área pública.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3202, 'ii', 'La hora de la historia' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3203, 'iii', 'Ministerio de los payasos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3203);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3204, 'iv', 'Ministerio de títeres' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3204);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3205, 'v', 'Preparar regalos de Navidad para los niños desfavorecidos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3205);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3206, 'vi', 'Alimentos y/o distribución de ropa para los necesitados' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3206);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6902), 3207, 'vii', 'Programas de visitas a un asilo de ancianos, orfanatos o sala pediátrica de un hospital' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3207);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6902), requirement_number = 3208, modified_at = now() WHERE requirement_id = pg_temp.rid(6903);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(6904);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3301, 'i', 'Cuidado del patio o el cuidado de la casa de los ancianos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3301);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3302, 'ii', 'Enseñar en una división menor del departamento de escuela sabática.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3302);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3303, 'iii', 'Charlas de temperancia' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3303);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3304, 'iv', 'Hacer tutoría a los estudiantes menores' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3304);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3305, 'v', 'Trabajo voluntario en un hospital o asilo de ancianos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3305);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3306, 'vi', 'Suministrar libros y juegos en un hospital' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3306);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3307, 'vii', 'Ayudar a la rehabilitación de una persona con discapacidad física' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3307);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, pg_temp.rid(6904), 3308, 'viii', 'Hacer carteles y los proyectos para un hospital, asilo de ancianos o un orfanato' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 394 AND requirement_number = 3308);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6904), requirement_number = 3309, modified_at = now() WHERE requirement_id = pg_temp.rid(6905);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6904), requirement_number = 3310, modified_at = now() WHERE requirement_id = pg_temp.rid(6906);

-- Gatos - Avanzado · requisito 2
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7136);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7136), requirement_number = 2101, modified_at = now() WHERE requirement_id = pg_temp.rid(7137);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7136), requirement_number = 2102, modified_at = now() WHERE requirement_id = pg_temp.rid(7138);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7136), requirement_number = 2103, modified_at = now() WHERE requirement_id = pg_temp.rid(7139);

-- Herrería · requisito 11
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7418);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7418), requirement_number = 11101, modified_at = now() WHERE requirement_id = pg_temp.rid(7419);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7418), requirement_number = 11102, modified_at = now() WHERE requirement_id = pg_temp.rid(7420);

-- Herrería · requisito 8
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7412);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7412), requirement_number = 8101, modified_at = now() WHERE requirement_id = pg_temp.rid(7413);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7412), requirement_number = 8102, modified_at = now() WHERE requirement_id = pg_temp.rid(7414);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7415);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 178, pg_temp.rid(7415), 8201, 'i', 'Peña cruzada' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 178 AND requirement_number = 8201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 178, pg_temp.rid(7415), 8202, 'ii', 'Peña angulada' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 178 AND requirement_number = 8202);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7415), requirement_number = 8203, modified_at = now() WHERE requirement_id = pg_temp.rid(7416);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7415), requirement_number = 8204, modified_at = now() WHERE requirement_id = pg_temp.rid(7417);

-- Herrería · requisito 7
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7404);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7101, modified_at = now() WHERE requirement_id = pg_temp.rid(7405);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7102, modified_at = now() WHERE requirement_id = pg_temp.rid(7406);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7103, modified_at = now() WHERE requirement_id = pg_temp.rid(7407);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7104, modified_at = now() WHERE requirement_id = pg_temp.rid(7408);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7105, modified_at = now() WHERE requirement_id = pg_temp.rid(7409);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7404), requirement_number = 7106, modified_at = now() WHERE requirement_id = pg_temp.rid(7410);

-- Información Programable · requisito 4
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7487);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4101, modified_at = now() WHERE requirement_id = pg_temp.rid(7488);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4102, modified_at = now() WHERE requirement_id = pg_temp.rid(7489);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4103, modified_at = now() WHERE requirement_id = pg_temp.rid(7490);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4104, modified_at = now() WHERE requirement_id = pg_temp.rid(7491);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4105, modified_at = now() WHERE requirement_id = pg_temp.rid(7492);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4106, modified_at = now() WHERE requirement_id = pg_temp.rid(7493);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4107, modified_at = now() WHERE requirement_id = pg_temp.rid(7494);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4108, modified_at = now() WHERE requirement_id = pg_temp.rid(7495);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4109, modified_at = now() WHERE requirement_id = pg_temp.rid(7496);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7487), requirement_number = 4110, modified_at = now() WHERE requirement_id = pg_temp.rid(7497);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, pg_temp.rid(7487), 4111, 'xi', 'Informe del libro de actas y eventos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 180 AND requirement_number = 4111);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, pg_temp.rid(7487), 4112, 'xii', 'Informe de mensualidades' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 180 AND requirement_number = 4112);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, pg_temp.rid(7487), 4113, 'xiii', 'Informe de unidades, clases, especialidades y Conquistadores' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 180 AND requirement_number = 4113);

-- Insectos · requisito 1
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(2893);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7510);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7510), requirement_number = 1101, modified_at = now() WHERE requirement_id = pg_temp.rid(7511);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7510), requirement_number = 1102, modified_at = now() WHERE requirement_id = pg_temp.rid(7512);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7510), requirement_number = 1103, modified_at = now() WHERE requirement_id = pg_temp.rid(7513);

-- Insectos - Avanzado · requisito 9
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(2906);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7522);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9101, modified_at = now() WHERE requirement_id = pg_temp.rid(7523);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9102, modified_at = now() WHERE requirement_id = pg_temp.rid(7524);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9103, modified_at = now() WHERE requirement_id = pg_temp.rid(7525);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9104, modified_at = now() WHERE requirement_id = pg_temp.rid(7526);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9105, modified_at = now() WHERE requirement_id = pg_temp.rid(7527);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7522), requirement_number = 9106, modified_at = now() WHERE requirement_id = pg_temp.rid(7528);

-- Mamíferos Pequeños Como Mascotas · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7796);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5101, modified_at = now() WHERE requirement_id = pg_temp.rid(7797);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5102, modified_at = now() WHERE requirement_id = pg_temp.rid(7798);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5103, modified_at = now() WHERE requirement_id = pg_temp.rid(7799);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5104, modified_at = now() WHERE requirement_id = pg_temp.rid(7800);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5105, modified_at = now() WHERE requirement_id = pg_temp.rid(7801);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5106, modified_at = now() WHERE requirement_id = pg_temp.rid(7802);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5107, modified_at = now() WHERE requirement_id = pg_temp.rid(7803);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7796), requirement_number = 5108, modified_at = now() WHERE requirement_id = pg_temp.rid(7804);

-- Mayordomía · requisito 6
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(3294);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7831);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6201, modified_at = now() WHERE requirement_id = pg_temp.rid(7832);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6202, modified_at = now() WHERE requirement_id = pg_temp.rid(7833);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6203, modified_at = now() WHERE requirement_id = pg_temp.rid(7834);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6204, modified_at = now() WHERE requirement_id = pg_temp.rid(7835);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6205, modified_at = now() WHERE requirement_id = pg_temp.rid(7836);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6206, modified_at = now() WHERE requirement_id = pg_temp.rid(7837);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6207, modified_at = now() WHERE requirement_id = pg_temp.rid(7838);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7831), requirement_number = 6208, modified_at = now() WHERE requirement_id = pg_temp.rid(7839);

-- Mensajera de Dios · requisito 1
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7858);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1401, modified_at = now() WHERE requirement_id = pg_temp.rid(7859);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1402, modified_at = now() WHERE requirement_id = pg_temp.rid(7860);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1403, modified_at = now() WHERE requirement_id = pg_temp.rid(7861);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1404, modified_at = now() WHERE requirement_id = pg_temp.rid(7862);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1405, modified_at = now() WHERE requirement_id = pg_temp.rid(7863);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1406, modified_at = now() WHERE requirement_id = pg_temp.rid(7864);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1407, modified_at = now() WHERE requirement_id = pg_temp.rid(7865);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1408, modified_at = now() WHERE requirement_id = pg_temp.rid(7866);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1409, modified_at = now() WHERE requirement_id = pg_temp.rid(7867);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7858), requirement_number = 1410, modified_at = now() WHERE requirement_id = pg_temp.rid(7868);

-- Ministerio de Transmisión de Medios · requisito 11
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(3385);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7928);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7928), requirement_number = 11101, modified_at = now() WHERE requirement_id = pg_temp.rid(7929);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7928), requirement_number = 11102, modified_at = now() WHERE requirement_id = pg_temp.rid(7930);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7928), requirement_number = 11103, modified_at = now() WHERE requirement_id = pg_temp.rid(7931);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7928), requirement_number = 11104, modified_at = now() WHERE requirement_id = pg_temp.rid(7932);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7933);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, pg_temp.rid(7933), 11201, 'i', '¿Cuál es el formato del programa (entrevista, discusión grupal, presentación individual, etc.)?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 414 AND requirement_number = 11201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, pg_temp.rid(7933), 11202, 'ii', '¿Cuánto dura el programa?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 414 AND requirement_number = 11202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, pg_temp.rid(7933), 11203, 'iii', '¿Cuál es el propósito del programa o la información presentada?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 414 AND requirement_number = 11203);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, pg_temp.rid(7933), 11204, 'iv', '¿Cuántas veces se ha visto o tocado? ¿O cuántas personas han sintonizado? (Si es aplicable)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 414 AND requirement_number = 11204);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7933), requirement_number = 11205, modified_at = now() WHERE requirement_id = pg_temp.rid(7934);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7933), requirement_number = 11206, modified_at = now() WHERE requirement_id = pg_temp.rid(7935);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7933), requirement_number = 11207, modified_at = now() WHERE requirement_id = pg_temp.rid(7936);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7933), requirement_number = 11208, modified_at = now() WHERE requirement_id = pg_temp.rid(7937);

-- Montañas · requisito 6
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(7977);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7977), requirement_number = 6101, modified_at = now() WHERE requirement_id = pg_temp.rid(7978);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7977), requirement_number = 6102, modified_at = now() WHERE requirement_id = pg_temp.rid(7979);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7977), requirement_number = 6103, modified_at = now() WHERE requirement_id = pg_temp.rid(7980);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7977), requirement_number = 6104, modified_at = now() WHERE requirement_id = pg_temp.rid(7981);

-- Navegación a Vela · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8028);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8028), requirement_number = 5201, modified_at = now() WHERE requirement_id = pg_temp.rid(8029);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8028), requirement_number = 5202, modified_at = now() WHERE requirement_id = pg_temp.rid(8030);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8028), requirement_number = 5203, modified_at = now() WHERE requirement_id = pg_temp.rid(8031);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8028), requirement_number = 5204, modified_at = now() WHERE requirement_id = pg_temp.rid(8032);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8028), requirement_number = 5205, modified_at = now() WHERE requirement_id = pg_temp.rid(8033);

-- Orientación con GPS · requisito 13
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8151);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8151), requirement_number = 13201, modified_at = now() WHERE requirement_id = pg_temp.rid(8152);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8151), requirement_number = 13202, modified_at = now() WHERE requirement_id = pg_temp.rid(8153);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8151), requirement_number = 13203, modified_at = now() WHERE requirement_id = pg_temp.rid(8154);

-- Predicar · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8364);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5301, modified_at = now() WHERE requirement_id = pg_temp.rid(8365);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5302, modified_at = now() WHERE requirement_id = pg_temp.rid(8366);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5303, modified_at = now() WHERE requirement_id = pg_temp.rid(8367);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5304, modified_at = now() WHERE requirement_id = pg_temp.rid(8368);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5305, modified_at = now() WHERE requirement_id = pg_temp.rid(8369);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5306, modified_at = now() WHERE requirement_id = pg_temp.rid(8370);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8364), requirement_number = 5307, modified_at = now() WHERE requirement_id = pg_temp.rid(8371);

-- Prevención de Enfermedades Tropicales · requisito 4
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8393);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8393), requirement_number = 4501, modified_at = now() WHERE requirement_id = pg_temp.rid(8394);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8393), requirement_number = 4502, modified_at = now() WHERE requirement_id = pg_temp.rid(8395);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8393), requirement_number = 4503, modified_at = now() WHERE requirement_id = pg_temp.rid(8396);

-- Procesar Texto · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8470);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5101, modified_at = now() WHERE requirement_id = pg_temp.rid(8471);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5102, modified_at = now() WHERE requirement_id = pg_temp.rid(8472);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5103, modified_at = now() WHERE requirement_id = pg_temp.rid(8473);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5104, modified_at = now() WHERE requirement_id = pg_temp.rid(8474);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5105, modified_at = now() WHERE requirement_id = pg_temp.rid(8475);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8470), requirement_number = 5106, modified_at = now() WHERE requirement_id = pg_temp.rid(8476);

-- Remo · requisito 3
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8569);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8569), requirement_number = 3301, modified_at = now() WHERE requirement_id = pg_temp.rid(8570);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8569), requirement_number = 3302, modified_at = now() WHERE requirement_id = pg_temp.rid(8571);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8569), requirement_number = 3303, modified_at = now() WHERE requirement_id = pg_temp.rid(8572);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8569), requirement_number = 3304, modified_at = now() WHERE requirement_id = pg_temp.rid(8573);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8569), requirement_number = 3305, modified_at = now() WHERE requirement_id = pg_temp.rid(8574);

-- Salud y Curación · requisito 5
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(4581);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8657);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8657), requirement_number = 5201, modified_at = now() WHERE requirement_id = pg_temp.rid(8658);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8657), requirement_number = 5202, modified_at = now() WHERE requirement_id = pg_temp.rid(8659);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8657), requirement_number = 5203, modified_at = now() WHERE requirement_id = pg_temp.rid(8660);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8657), requirement_number = 5204, modified_at = now() WHERE requirement_id = pg_temp.rid(8661);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8663);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, pg_temp.rid(8663), 5401, 'i', 'Observar las zonas de trabajo en el departamento' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 603 AND requirement_number = 5401);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, pg_temp.rid(8663), 5402, 'ii', 'Obtener una charla introductoria de los equipos utilizados en el departamento y cómo funciona' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 603 AND requirement_number = 5402);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, pg_temp.rid(8663), 5403, 'iii', 'Conocer los pasos que toma un paciente cuando visita al departamento.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 603 AND requirement_number = 5403);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, pg_temp.rid(8663), 5404, 'iv', '¿Cuántas personas se necesitan en el departamento?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 603 AND requirement_number = 5404);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8663), requirement_number = 5405, modified_at = now() WHERE requirement_id = pg_temp.rid(8664);

-- Teñido Anudado - Avanzado · requisito 3
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8953);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8953), requirement_number = 3101, modified_at = now() WHERE requirement_id = pg_temp.rid(8954);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8953), requirement_number = 3102, modified_at = now() WHERE requirement_id = pg_temp.rid(8955);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8953), requirement_number = 3103, modified_at = now() WHERE requirement_id = pg_temp.rid(8956);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8953), requirement_number = 3104, modified_at = now() WHERE requirement_id = pg_temp.rid(8957);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(8958);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, pg_temp.rid(8958), 3201, 'i', 'Nudo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 326 AND requirement_number = 3201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, pg_temp.rid(8958), 3202, 'ii', 'Espiral' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 326 AND requirement_number = 3202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, pg_temp.rid(8958), 3203, 'iii', 'Rosetas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 326 AND requirement_number = 3203);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, pg_temp.rid(8958), 3204, 'iv', 'Círculos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 326 AND requirement_number = 3204);
UPDATE honor_requirements SET parent_id = pg_temp.rid(8958), requirement_number = 3205, modified_at = now() WHERE requirement_id = pg_temp.rid(8959);

-- Trabajos de Aguja · requisito 1
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(9041);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9041), requirement_number = 1201, modified_at = now() WHERE requirement_id = pg_temp.rid(9042);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9041), requirement_number = 1202, modified_at = now() WHERE requirement_id = pg_temp.rid(9043);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9041), requirement_number = 1203, modified_at = now() WHERE requirement_id = pg_temp.rid(9044);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(9046);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, pg_temp.rid(9046), 1401, 'i', 'Aplicación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 328 AND requirement_number = 1401);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, pg_temp.rid(9046), 1402, 'ii', 'Vainillas o Vainicas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 328 AND requirement_number = 1402);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, pg_temp.rid(9046), 1403, 'iii', 'Punto smock (frunce)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 328 AND requirement_number = 1403);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9046), requirement_number = 1404, modified_at = now() WHERE requirement_id = pg_temp.rid(9047);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9046), requirement_number = 1405, modified_at = now() WHERE requirement_id = pg_temp.rid(9048);

-- Viajes - Avanzado · requisito 5
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(9153);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9153), requirement_number = 5101, modified_at = now() WHERE requirement_id = pg_temp.rid(9154);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9153), requirement_number = 5102, modified_at = now() WHERE requirement_id = pg_temp.rid(9155);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9153), requirement_number = 5103, modified_at = now() WHERE requirement_id = pg_temp.rid(9156);
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(9157);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, pg_temp.rid(9157), 5201, 'i', 'Pasaje aéreo de ida y venida a ese país' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 138 AND requirement_number = 5201);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, pg_temp.rid(9157), 5202, 'ii', 'Alquiler de automóviles (económico/compacto)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 138 AND requirement_number = 5202);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, pg_temp.rid(9157), 5203, 'iii', 'Costo de la gasolina legítimo (recordar que diferentes países tienen la lista de precios de la gasolina por litro o por galón)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 138 AND requirement_number = 5203);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9157), requirement_number = 5204, modified_at = now() WHERE requirement_id = pg_temp.rid(9158);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9157), requirement_number = 5205, modified_at = now() WHERE requirement_id = pg_temp.rid(9159);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9157), requirement_number = 5206, modified_at = now() WHERE requirement_id = pg_temp.rid(9160);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9157), requirement_number = 5207, modified_at = now() WHERE requirement_id = pg_temp.rid(9161);
UPDATE honor_requirements SET parent_id = pg_temp.rid(9157), requirement_number = 5208, modified_at = now() WHERE requirement_id = pg_temp.rid(9162);

DROP FUNCTION pg_temp.rid(integer);
DROP TABLE _idmap;

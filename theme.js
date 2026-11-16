// 화면이 그려지기 전에 테마를 정한다. 기본은 다크, 버튼으로 바꾼 선택이 저장돼 있으면 그것을 따른다
(function () {
  var t; try { t = localStorage.getItem('theme'); } catch (e) {}
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
})();

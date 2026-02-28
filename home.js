const HomeApp = (() => {
  const statsRoot = document.querySelector("[data-site-stats]");
  const heroProfileCount = document.querySelector("[data-home='profiles']");
  const heroVoteCount = document.querySelector("[data-home='votes']");
  const heroUpdated = document.querySelector("[data-home='updated']");

  async function boot() {
    const { stats } = await window.Folkevalget.loadCatalogueData();
    window.Folkevalget.renderStats(statsRoot, stats);
    renderHeroNumbers(stats);
  }

  function renderHeroNumbers(stats) {
    heroProfileCount.textContent = window.Folkevalget.formatNumber(stats.counts?.profiles);
    heroVoteCount.textContent = window.Folkevalget.formatNumber(stats.counts?.votes);
    heroUpdated.textContent = window.Folkevalget.formatDate(stats.generated_at);
  }

  return { boot };
})();

HomeApp.boot().catch((error) => {
  console.error(error);
});

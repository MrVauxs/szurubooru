<?php
namespace Szurubooru\Upgrades;

class Upgrade04 implements IUpgrade
{
	private $postDao;
	private $postService;
	private $fileService;

	public function __construct(
		\Szurubooru\Dao\PostDao $postDao,
		\Szurubooru\Services\PostService $postService,
		\Szurubooru\Services\FileService $fileService)
	{
		$this->postDao = $postDao;
		$this->postService = $postService;
		$this->fileService = $fileService;
	}

	public function run(\Szurubooru\DatabaseConnection $databaseConnection)
	{
		$databaseConnection->getPDO()->exec('ALTER TABLE posts ADD COLUMN contentMimeType VARCHAR(64) DEFAULT NULL');

		$posts = $this->postDao->findAll();
		foreach ($posts as $post)
		{
			if ($post->getContentType() !== \Szurubooru\Entities\Post::POST_TYPE_YOUTUBE)
			{
				$fullPath = $this->fileService->getFullPath($post->getContentPath());
				$mime = \Szurubooru\Helpers\MimeHelper::getMimeTypeFromFile($fullPath);
				$post->setContentMimeType($mime);
				$this->postDao->save($post);
			}
		}
	}
}
